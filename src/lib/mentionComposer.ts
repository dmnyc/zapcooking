/**
 * Stateful controller for the mention/autocomplete system.
 * Each component creates one instance, passing callbacks for state and text changes.
 * Uses the singleton followListCache for profile data.
 */
import { nip19 } from 'nostr-tools';
import { get } from 'svelte/store';
import { ndk } from '$lib/nostr';
import { searchProfiles, type SearchProfile } from '$lib/profileSearchService';
import { sanitizeHTML } from '$lib/sanitize';
import {
	loadFollowListProfiles,
	getProfileCache,
	addToCache,
	type CachedProfile
} from '$lib/followListCache';
import {
	htmlToPlainText,
	getTextBeforeCursor,
	deleteCharsBeforeCursor,
	createMentionPill,
	getDisplayNameForMention,
	renderTextWithMentions,
	replacePlainMentions as replacePlainMentionsUtil,
	parseMentions as parseMentionsUtil,
	escapeRegex,
	isComposerEmpty,
	transferText
} from '$lib/mentionUtils';
import { seedProfileCache } from '$lib/profileResolver';

export type { CachedProfile } from '$lib/followListCache';

export interface MentionSuggestion {
	name: string;
	npub: string;
	picture?: string;
	pubkey: string;
	nip05?: string;
}

export interface MentionState {
	mentionQuery: string;
	showMentionSuggestions: boolean;
	mentionSuggestions: MentionSuggestion[];
	selectedMentionIndex: number;
	mentionSearching: boolean;
}

type StateChangeCallback = (state: MentionState) => void;
type TextChangeCallback = (text: string) => void;

// Regex to detect @mention trigger before cursor.
// Uses [^@] instead of [^\s@] to allow spaces in names (PR #143 fix #1).
// The @ must sit at a word boundary: typing an email or Lightning address
// (daniel@breez.tips) must not open the mention popup just because the
// domain names a cached profile. Character-class boundary rather than
// lookbehind — embedded WebViews ship without lookbehind support.
export const MENTION_TRIGGER_REGEX = /(?:^|[^\p{L}\p{N}_])@([^@]*)$/u;

/**
 * How many characters before the caret a picked mention replaces: the @ and
 * the query only. The trigger's match also holds the boundary character in
 * front of the @ (`(`, `.`, an emoji), which must stay. Null when no
 * mention is being typed.
 */
export function mentionReplaceLength(textBeforeCursor: string): number | null {
	const m = textBeforeCursor.match(MENTION_TRIGGER_REGEX);
	return m ? m[1].length + 1 : null;
}

// Zero-width space (U+200B). Inserted around mention pills as caret-landing
// spacers so the selection has somewhere to sit on either side of the
// contenteditable=false pill. Invisible to the user and stripped on content
// extraction (htmlToPlainText). Use the named constant rather than the literal
// character so it stays visible to reviewers and survives formatters.
const ZWSP = '\u200B';
const ZWSP_REGEX = /\u200B/g;

function isZwspOnlyText(node: Node | null): node is Text {
	if (!node || node.nodeType !== Node.TEXT_NODE) return false;
	const value = (node as Text).nodeValue ?? '';
	return value.length > 0 && value.replace(ZWSP_REGEX, '').length === 0;
}

// When two pills are adjacent, the HTML parser can coalesce their facing
// ZWSP spacers into a single text node holding multiple ZWSPs. Removing
// the whole node would strip the neighbor pill's caret landing spot too,
// so trim down to one ZWSP if more remain after this pill is gone.
function trimOrRemoveZwspText(node: Text): void {
	const value = node.nodeValue ?? '';
	if (value.length > 1) {
		node.nodeValue = ZWSP;
		return;
	}
	node.remove();
}

function removePillWithZwsps(pill: HTMLElement): void {
	const before = pill.previousSibling;
	const after = pill.nextSibling;
	if (isZwspOnlyText(before)) trimOrRemoveZwspText(before);
	if (isZwspOnlyText(after)) trimOrRemoveZwspText(after);
	pill.remove();
}

// The caret position under a point (a drop's), in either engine's API.
function caretRangeAt(x: number, y: number): Range | null {
	const doc = document as Document & {
		caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
		caretRangeFromPoint?: (x: number, y: number) => Range | null;
	};
	if (typeof doc.caretPositionFromPoint === 'function') {
		const pos = doc.caretPositionFromPoint(x, y);
		if (!pos) return null;
		const range = document.createRange();
		range.setStart(pos.offsetNode, pos.offset);
		range.collapse(true);
		return range;
	}
	if (typeof doc.caretRangeFromPoint === 'function') return doc.caretRangeFromPoint(x, y);
	return null;
}

export class MentionComposerController {
	private composerEl: HTMLDivElement | null = null;
	private searchTimeout: ReturnType<typeof setTimeout> | null = null;
	private onStateChange: StateChangeCallback;
	private onTextChange: TextChangeCallback;

	// Monotonic id for the search in flight. Each keystroke bumps it; an
	// async source resolving for a stale query drops its result instead
	// of painting over the newer one.
	private searchSeq = 0;

	// A drag that started inside this composer: dropping it is a move the
	// browser already does well, so handleDrop leaves it alone.
	private dragFromComposer = false;

	// A line break was just typed: the input that follows it closes the typing
	// step, so the next line's words are an undo step of their own.
	private closeTypingAfterInput = false;

	// Internal state
	mentionQuery = '';
	showMentionSuggestions = false;
	mentionSuggestions: MentionSuggestion[] = [];
	selectedMentionIndex = 0;
	mentionSearching = false;

	constructor(onStateChange: StateChangeCallback, onTextChange: TextChangeCallback) {
		this.onStateChange = onStateChange;
		this.onTextChange = onTextChange;
	}

	/** Call when bind:this resolves or changes */
	setComposerEl(el: HTMLDivElement | null): void {
		this.composerEl = el;
	}

	/** Preload follow list (call from onMount) */
	preloadFollowList(): void {
		loadFollowListProfiles();
	}

	/** Sync HTML into the composer from a text value */
	syncContent(value: string): void {
		if (!this.composerEl) return;
		const html = sanitizeHTML(renderTextWithMentions(value, getProfileCache()));
		if (this.composerEl.innerHTML !== html) {
			this.composerEl.innerHTML = html;
		}
		this.refreshEmptyState();
	}

	/** Extract plain text from composer DOM */
	extractText(): string {
		if (!this.composerEl) return '';
		return htmlToPlainText(this.composerEl);
	}

	/** Replace @name and @npub with nostr:npub format using the shared cache */
	replacePlainMentions(text: string): string {
		return replacePlainMentionsUtil(text, getProfileCache());
	}

	/** Parse mentions from text */
	parseMentions(text: string): Map<string, string> {
		return parseMentionsUtil(text);
	}

	/** Handle the input event on the composer — called from on:input */
	handleInput(): string {
		if (this.closeTypingAfterInput) {
			this.closeTypingAfterInput = false;
			this.closeTypingStep();
		}
		const text = this.updateContentFromComposer();
		if (!this.composerEl) return text;

		const converted = this.convertRawMentionsToPills();
		let finalText = text;
		if (converted) {
			finalText = this.updateContentFromComposer();
		}

		const textBeforeCursor = getTextBeforeCursor(this.composerEl);
		const mentionMatch = textBeforeCursor.match(MENTION_TRIGGER_REGEX);

		if (mentionMatch) {
			this.mentionQuery = mentionMatch[1] || '';
			this.showMentionSuggestions = true;

			if (this.searchTimeout) clearTimeout(this.searchTimeout);
			this.searchTimeout = setTimeout(() => {
				if (this.mentionQuery.length > 0) {
					this.searchMentionUsers(this.mentionQuery);
				} else {
					this.mentionSuggestions = Array.from(getProfileCache().values()).slice(0, 8);
					this.selectedMentionIndex = 0;
					this.notifyStateChange();
				}
			}, 150);
		} else {
			this.showMentionSuggestions = false;
			this.mentionSuggestions = [];
		}

		this.notifyStateChange();
		return finalText;
	}

	/** Handle keydown — returns true if the event was consumed */
	handleKeydown(event: KeyboardEvent): boolean {
		const selection = window.getSelection();
		if (selection && selection.rangeCount) {
			const range = selection.getRangeAt(0);

			// Delete key — remove mention pill ahead of cursor. Treats
			// ZWSP-only text nodes (the pill's caret-landing spacers) as
			// transparent so one press removes the pill + its ZWSPs.
			if (event.key === 'Delete' && range.collapsed) {
				const { startContainer, startOffset } = range;
				if (startContainer.nodeType === Node.TEXT_NODE) {
					const textNode = startContainer as Text;
					const value = textNode.nodeValue ?? '';
					const afterCursor = value.slice(startOffset);
					if (afterCursor.replace(ZWSP_REGEX, '').length === 0) {
						let next: Node | null = textNode.nextSibling;
						if (isZwspOnlyText(next)) next = next.nextSibling;
						if (
							next &&
							next.nodeType === Node.ELEMENT_NODE &&
							(next as HTMLElement).dataset.mention
						) {
							event.preventDefault();
							if (afterCursor.length > 0) {
								textNode.nodeValue = value.slice(0, startOffset);
							}
							removePillWithZwsps(next as HTMLElement);
							this.updateContentFromComposer();
							return true;
						}
					}
				}
			}

			// Backspace — remove mention pill behind cursor
			if (event.key === 'Backspace') {
				if (!range.collapsed) {
					const container = range.commonAncestorContainer;
					let mentionElement: HTMLElement | null = null;

					if (container.nodeType === Node.ELEMENT_NODE) {
						const el = container as HTMLElement;
						if (el.dataset.mention) {
							mentionElement = el;
						}
					} else if (container.parentElement?.dataset.mention) {
						mentionElement = container.parentElement;
					}

					if (mentionElement) {
						event.preventDefault();
						removePillWithZwsps(mentionElement);
						this.updateContentFromComposer();
						return true;
					}
				}

				if (range.collapsed) {
					const { startContainer, startOffset } = range;
					if (startContainer.nodeType === Node.TEXT_NODE) {
						const textNode = startContainer as Text;
						const value = textNode.nodeValue ?? '';
						const beforeCursor = value.slice(0, startOffset);
						if (beforeCursor.replace(ZWSP_REGEX, '').length === 0) {
							let prev: Node | null = textNode.previousSibling;
							if (isZwspOnlyText(prev)) prev = prev.previousSibling;
							if (
								prev &&
								prev.nodeType === Node.ELEMENT_NODE &&
								(prev as HTMLElement).dataset.mention
							) {
								event.preventDefault();
								if (beforeCursor.length > 0) {
									textNode.nodeValue = value.slice(startOffset);
									const newRange = document.createRange();
									newRange.setStart(textNode, 0);
									newRange.collapse(true);
									selection.removeAllRanges();
									selection.addRange(newRange);
								}
								removePillWithZwsps(prev as HTMLElement);
								this.updateContentFromComposer();
								return true;
							}
						}
					}
				}
			}
		}

		// Mention suggestion navigation
		if (this.showMentionSuggestions && this.mentionSuggestions.length > 0) {
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				this.selectedMentionIndex =
					(this.selectedMentionIndex + 1) % this.mentionSuggestions.length;
				this.notifyStateChange();
				return true;
			} else if (event.key === 'ArrowUp') {
				event.preventDefault();
				this.selectedMentionIndex =
					this.selectedMentionIndex === 0
						? this.mentionSuggestions.length - 1
						: this.selectedMentionIndex - 1;
				this.notifyStateChange();
				return true;
			} else if (event.key === 'Enter' || event.key === 'Tab') {
				event.preventDefault();
				this.insertMention(this.mentionSuggestions[this.selectedMentionIndex]);
				return true;
			} else if (event.key === 'Escape') {
				this.showMentionSuggestions = false;
				this.mentionSuggestions = [];
				this.notifyStateChange();
				return true;
			}
		}

		return false;
	}

	/** Handle beforeinput event — prevents editing inside mention pills */
	handleBeforeInput(event: InputEvent): void {
		if (
			event.isComposing ||
			event.inputType === 'historyUndo' ||
			event.inputType === 'historyRedo'
		) {
			return;
		}

		// A line break is an undo boundary on both sides: Undo never takes the end
		// of one line together with the start of the next (see closeTypingStep).
		if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
			this.closeTypingStep();
			this.closeTypingAfterInput = true;
		}

		const selection = window.getSelection();
		if (!selection || !this.composerEl) return;
		const range = selection.getRangeAt(0);
		let node: Node | null = range.startContainer;

		while (node && node !== this.composerEl) {
			if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.mention) {
				event.preventDefault();

				if (event.inputType === 'insertText' || event.inputType === 'insertCompositionText') {
					const newRange = document.createRange();
					newRange.setStartAfter(node);
					newRange.collapse(true);
					selection.removeAllRanges();
					selection.addRange(newRange);
				}
				return;
			}
			node = node.parentNode;
		}
	}

	/**
	 * Handle paste — the clipboard's text goes in as plain text, through the
	 * browser's own insertText so the paste is one step on the undo stack
	 * (Undo takes it back out, Redo puts it back). Building the fragment by
	 * hand with range.insertNode kept rich text out but bypassed the undo
	 * stack: Undo after a paste undid the typing before it instead.
	 * transferText reads HTML-only clipboards, re-reads this composer's own
	 * pills as their nostr: addresses, and drops `\r`.
	 */
	handlePaste(event: ClipboardEvent): void {
		event.preventDefault();
		this.insertPlainText(transferText(event.clipboardData));
	}

	/**
	 * Handle copy and cut — what goes on the clipboard is the note's own text
	 * (the serializer's, so a mention is its nostr: address and blank lines
	 * are the `\n`s typed), plus this composer's markup so a paste back here
	 * restores the pills. Left to the browser, the plain text of a selection
	 * spanning lines gained a trailing newline and a pill copied as "@name".
	 * Cut deletes through execCommand, so Undo restores the text.
	 */
	handleCopy(event: ClipboardEvent, cut = false): void {
		const selection = window.getSelection();
		if (!this.composerEl || !event.clipboardData || !selection || selection.rangeCount === 0) return;
		const range = selection.getRangeAt(0);
		if (range.collapsed || !this.composerEl.contains(range.commonAncestorContainer)) return;
		const box = document.createElement('div');
		box.appendChild(range.cloneContents());
		event.preventDefault();
		event.clipboardData.setData('text/plain', htmlToPlainText(box));
		event.clipboardData.setData('text/html', box.innerHTML);
		if (cut) document.execCommand('delete');
	}

	/** Remember a drag that starts inside this composer (see handleDrop). */
	handleDragStart(event: DragEvent): void {
		const target = event.target as Node | null;
		this.dragFromComposer = !!(target && this.composerEl?.contains(target));
	}

	handleDragEnd(): void {
		this.dragFromComposer = false;
	}

	/**
	 * Handle text dropped in from another page. A drop never reaches the paste
	 * handler: left to the browser, a drag from a web page brought its bold,
	 * colors, links and pictures straight into the editor — shown there, but
	 * not what the note publishes. The dropped text goes in as plain text at
	 * the drop point instead, as one undoable step. Files are left alone (the
	 * composer's own attachment handling owns them), and so is a drag that
	 * moves text within this composer.
	 */
	handleDrop(event: DragEvent): void {
		const data = event.dataTransfer;
		if (!data || !this.composerEl) return;
		if (this.dragFromComposer) {
			this.dragFromComposer = false;
			return;
		}
		if (Array.from(data.types || []).includes('Files')) return;
		event.preventDefault();
		const text = transferText(data);
		const at = caretRangeAt(event.clientX, event.clientY);
		this.composerEl.focus();
		if (at && this.composerEl.contains(at.startContainer)) {
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(at);
		}
		this.insertPlainText(text);
	}

	/**
	 * Insert plain text at the caret as typing would: through the browser's
	 * editing command, so it is undoable and fires the input event that keeps
	 * `content` and the mention pills in step.
	 */
	insertPlainText(text: string): void {
		if (!text || !this.composerEl) return;
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return;
		if (!this.composerEl.contains(selection.getRangeAt(0).startContainer)) return;
		// Its own undo step: Chrome folds an insertText into the typing just before
		// it, so Undo after typing "a " and pasting straight away took the typing
		// too (and only the paste when a pause had closed the step in between).
		this.closeTypingStep();
		if (!document.execCommand('insertText', false, text)) {
			// No editing command (very old engines): insert the text node directly.
			const range = selection.getRangeAt(0);
			range.deleteContents();
			const node = document.createTextNode(text);
			range.insertNode(node);
			range.setStartAfter(node);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
			this.handleInput();
		}
	}

	/**
	 * End the browser's open typing step, so the next edit starts an undo step
	 * of its own. Chrome keeps adding keystrokes, line breaks and inserted text
	 * to one typing step until something closes it, and what closed it was a
	 * pause or a click, so where Undo stopped depended on timing. Setting the
	 * selection again, unchanged, closes the step.
	 */
	closeTypingStep(): void {
		const selection = window.getSelection();
		if (!this.composerEl || !selection || selection.rangeCount === 0) return;
		const at = selection.getRangeAt(0);
		if (!this.composerEl.contains(at.startContainer)) return;
		selection.removeAllRanges();
		selection.addRange(at);
	}

	/**
	 * Keep `data-empty` on the composer in step with what it holds, so the
	 * placeholder shows whenever it reads as empty (isComposerEmpty), including
	 * the line holder the browser leaves after everything is deleted. The
	 * holder itself is left in place: clearing the editor's HTML would wipe
	 * its undo history, and Undo after Select All + Delete must bring the text
	 * back.
	 */
	refreshEmptyState(): void {
		if (!this.composerEl) return;
		const empty = isComposerEmpty(this.composerEl);
		if (this.composerEl.dataset.empty !== String(empty)) {
			this.composerEl.dataset.empty = String(empty);
		}
	}

	/** Insert a selected mention user at the cursor position */
	insertMention(user: MentionSuggestion): void {
		if (!this.composerEl) return;

		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return;
		const replace = mentionReplaceLength(getTextBeforeCursor(this.composerEl));

		if (replace !== null) {
			deleteCharsBeforeCursor(replace);
		}

		// PR #143 fix #2: insert leading space if preceded by non-whitespace
		const textAfterDeletion = getTextBeforeCursor(this.composerEl);
		const needsLeadingSpace = textAfterDeletion.length > 0 && !/\s$/.test(textAfterDeletion);

		if (needsLeadingSpace) {
			const spaceNode = document.createTextNode(' ');
			const sel = window.getSelection();
			if (sel && sel.rangeCount > 0) {
				const range = sel.getRangeAt(0);
				range.insertNode(spaceNode);
				range.setStartAfter(spaceNode);
				range.collapse(true);
				sel.removeAllRanges();
				sel.addRange(range);
			}
		}

		const mention = `nostr:${user.npub}`;
		this.insertMentionNode(mention, user.name, true);

		addToCache(user);
		seedProfileCache(user.pubkey, { name: user.name, picture: user.picture });
		this.updateContentFromComposer();
		this.showMentionSuggestions = false;
		this.mentionSuggestions = [];
		this.notifyStateChange();
	}

	/** Reset mention state (call after posting / clearing composer) */
	resetMentionState(): void {
		this.showMentionSuggestions = false;
		this.mentionSuggestions = [];
		this.mentionQuery = '';
		this.selectedMentionIndex = 0;
		if (this.searchTimeout) clearTimeout(this.searchTimeout);
		this.notifyStateChange();
	}

	/** Cleanup (call from onDestroy) */
	destroy(): void {
		if (this.searchTimeout) clearTimeout(this.searchTimeout);
	}

	// --- Private methods ---

	private notifyStateChange(): void {
		this.onStateChange({
			mentionQuery: this.mentionQuery,
			showMentionSuggestions: this.showMentionSuggestions,
			mentionSuggestions: this.mentionSuggestions,
			selectedMentionIndex: this.selectedMentionIndex,
			mentionSearching: this.mentionSearching
		});
	}

	private updateContentFromComposer(): string {
		if (!this.composerEl) return '';
		const newText = htmlToPlainText(this.composerEl);
		this.refreshEmptyState();
		this.onTextChange(newText);
		return newText;
	}

	private async searchMentionUsers(query: string): Promise<void> {
		// Trigger follow list load (non-blocking)
		loadFollowListProfiles();

		const seq = ++this.searchSeq;
		const queryLower = query.toLowerCase();
		const matches: MentionSuggestion[] = [];
		const seenPubkeys = new Set<string>();
		const cache = getProfileCache();

		// Sort + paint the current match set — called after the local cache
		// AND after each index resolves, so a fast answer (Nostr Archives
		// typically ~200ms) paints without waiting for the slowest index.
		// The seq guard drops paints from a query that has since been
		// superseded by a newer keystroke.
		const paint = () => {
			if (seq !== this.searchSeq) return;
			const tier = (p: MentionSuggestion): number => {
				const name = p.name.toLowerCase();
				if (name === queryLower) return 0;
				if (name.startsWith(queryLower)) return 1;
				const local = p.nip05?.split('@')[0]?.toLowerCase();
				if (local === queryLower) return 2;
				if (local?.startsWith(queryLower)) return 3;
				return 4;
			};
			matches.sort((a, b) => tier(a) - tier(b) || a.name.localeCompare(b.name));
			this.mentionSuggestions = matches.slice(0, 10);
			this.selectedMentionIndex = Math.min(this.selectedMentionIndex, this.mentionSuggestions.length - 1);
			if (this.selectedMentionIndex < 0) this.selectedMentionIndex = 0;
			this.notifyStateChange();
		};

		// Search local cache — by name AND NIP-05
		for (const profile of cache.values()) {
			const nameMatch = profile.name.toLowerCase().includes(queryLower);
			const nip05Match = profile.nip05?.toLowerCase().includes(queryLower);

			if (nameMatch || nip05Match) {
				matches.push(profile);
				seenPubkeys.add(profile.pubkey);
			}
		}

		// Show local matches immediately
		if (matches.length > 0) {
			paint();
		}

		const shouldSearchPrimal = query.length >= 2;
		const ndkInstance = get(ndk);
		const shouldSearchNdk = query.length >= 1 && ndkInstance;

		if (shouldSearchPrimal || shouldSearchNdk) {
			this.mentionSearching = true;
			this.notifyStateChange();

			const merge = (pubkey: string, data: Omit<MentionSuggestion, 'pubkey' | 'npub'>) => {
				if (seenPubkeys.has(pubkey)) return;
				seenPubkeys.add(pubkey);
				const profileData: MentionSuggestion = {
					...data,
					pubkey,
					npub: nip19.npubEncode(pubkey)
				};
				matches.push(profileData);
				addToCache(profileData);
			};

			try {
				// THREE INDEPENDENT INDEXES, RUN IN PARALLEL AND ISOLATED.
				// These used to await one another inside one try block: a
				// hanging NDK relay search (fetchEvents has no timeout of
				// its own) held the Nostr Archives merge hostage, and a
				// Primal throw skipped it entirely — the dropdown showed
				// only local cache matches while the right user sat in an
				// index that had already answered. Whatever resolves,
				// merges AND PAINTS IMMEDIATELY — the final list never
				// waits on the slowest index.
				const tasks: Promise<void>[] = [];

				if (shouldSearchPrimal) {
					// Both global name indexes (Primal + Nostr Archives) come
					// through searchProfiles, which queries each once and
					// reports each answer as it lands.
					const mergeProfiles = (profiles: SearchProfile[]) => {
						for (const profile of profiles) {
							merge(profile.pubkey, {
								name:
									profile.displayName ||
									profile.name ||
									profile.nip05?.split('@')[0] ||
									'Unknown',
								picture: profile.picture,
								nip05: profile.nip05
							});
						}
						paint();
					};
					tasks.push(
						searchProfiles(query, 25, { onPartial: mergeProfiles })
							.then(mergeProfiles)
							.catch(() => {})
					);
				}

				if (shouldSearchNdk && ndkInstance) {
					// Bounded: a relay that never sends EOSE must not hold
					// the whole search open.
					tasks.push(
						Promise.race([
							ndkInstance.fetchEvents({
								kinds: [0],
								search: query,
								limit: 50
							}),
							new Promise<Set<never>>((resolve) => setTimeout(() => resolve(new Set()), 3000))
						])
							.then((searchResults) => {
								for (const event of searchResults) {
									try {
										const profile = JSON.parse(event.content);
										const name = profile.display_name || profile.name || '';
										const nip05 = profile.nip05;
										merge(event.pubkey, {
											name: name || nip05?.split('@')[0] || profile.name || 'Unknown',
											picture: profile.picture,
											nip05
										});
									} catch {}
								}
								paint();
							})
							.catch(() => {})
					);
				}

				await Promise.allSettled(tasks);
			} finally {
				if (seq === this.searchSeq) this.mentionSearching = false;
			}
		}

		// Final paint for the run that is still current.
		paint();
	}

	private insertMentionNode(
		mention: string,
		displayName: string,
		addTrailingSpace = false
	): void {
		if (!this.composerEl) return;

		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return;
		const range = selection.getRangeAt(0);

		const pill = createMentionPill(mention, displayName);
		const newRange = document.createRange();
		newRange.setStart(range.startContainer, range.startOffset);
		newRange.collapse(true);

		// Zero-width spaces around the pill give the caret a landing spot on
		// both sides of the contenteditable=false span. Without them, iOS
		// Safari renders the caret at end-of-line (far right of the input)
		// and users can't tap before the pill to type leading text.
		const leadingZwsp = document.createTextNode(ZWSP);
		newRange.insertNode(leadingZwsp);
		newRange.setStartAfter(leadingZwsp);
		newRange.insertNode(pill);
		newRange.setStartAfter(pill);

		const trailingZwsp = document.createTextNode(ZWSP);
		newRange.insertNode(trailingZwsp);
		newRange.setStartAfter(trailingZwsp);

		if (addTrailingSpace) {
			const spacer = document.createTextNode(' ');
			newRange.insertNode(spacer);
			newRange.setStartAfter(spacer);
		}

		newRange.collapse(true);
		selection.removeAllRanges();
		selection.addRange(newRange);
	}

	private convertRawMentionsToPills(): boolean {
		if (!this.composerEl) return false;

		const rawText = this.composerEl.textContent || '';
		if (!rawText.includes('npub1')) return false;

		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;

		const range = selection.getRangeAt(0);
		const marker = document.createElement('span');
		marker.dataset.mentionCaret = 'true';
		marker.textContent = ZWSP;
		range.insertNode(marker);

		const composerEl = this.composerEl;
		const textNodes: Text[] = [];
		const walker = document.createTreeWalker(composerEl, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				const parent = node.parentElement;
				if (!parent) return NodeFilter.FILTER_REJECT;
				if (parent.dataset.mention || parent.dataset.mentionCaret)
					return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			}
		});

		while (walker.nextNode()) {
			textNodes.push(walker.currentNode as Text);
		}

		const cache = getProfileCache();
		let converted = false;
		for (const textNode of textNodes) {
			const text = textNode.nodeValue;
			if (!text || !text.includes('npub1')) continue;

			const mentionRegex =
				/@npub1[023456789acdefghjklmnpqrstuvwxyz]{58}|nostr:(npub1[023456789acdefghjklmnpqrstuvwxyz]{58}|nprofile1[023456789acdefghjklmnpqrstuvwxyz]+)/g;
			let lastIndex = 0;
			let match: RegExpExecArray | null;
			let hasMatch = false;
			const fragment = document.createDocumentFragment();

			while ((match = mentionRegex.exec(text)) !== null) {
				hasMatch = true;
				const before = text.slice(lastIndex, match.index);
				if (before) {
					fragment.appendChild(document.createTextNode(before));
				}

				const rawMention = match[0];
				const mention = rawMention.startsWith('@')
					? `nostr:${rawMention.slice(1)}`
					: rawMention;
				const displayName = getDisplayNameForMention(mention, cache);
				// ZWSP spacers give the caret a landing spot on either side of
				// the contenteditable=false pill (see insertMentionNode).
				fragment.appendChild(document.createTextNode(ZWSP));
				fragment.appendChild(createMentionPill(mention, displayName));
				fragment.appendChild(document.createTextNode(ZWSP));

				lastIndex = match.index + rawMention.length;
			}

			if (!hasMatch) continue;
			converted = true;

			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
			}

			textNode.parentNode?.replaceChild(fragment, textNode);
		}

		const caretMarker = composerEl.querySelector('[data-mention-caret]');
		if (caretMarker) {
			const newRange = document.createRange();
			newRange.setStartAfter(caretMarker);
			newRange.collapse(true);
			selection.removeAllRanges();
			selection.addRange(newRange);
			caretMarker.remove();
		}

		return converted;
	}
}

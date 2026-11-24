<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import { Editor, Extension } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import Image from '@tiptap/extension-image';
	import Link from '@tiptap/extension-link';
	import Placeholder from '@tiptap/extension-placeholder';
	import CharacterCount from '@tiptap/extension-character-count';
	import Mention from '@tiptap/extension-mention';
	import { mentionSuggestion } from './mentionSuggestion';
	import { TextSelection, AllSelection, NodeSelection } from '@tiptap/pm/state';
	import { ndk } from '$lib/nostr';
	import { NDKEvent } from '@nostr-dev-kit/ndk';
	import { Fetch } from 'hurdak';
	import { DOMParser as PMDOMParser, DOMSerializer, Fragment as PMFragment, Slice as PMSlice } from '@tiptap/pm/model';
	import type { Node as PMNode, Schema as PMSchema } from '@tiptap/pm/model';
	import type { EditorView } from '@tiptap/pm/view';
	import EditorToolbar from './EditorToolbar.svelte';

	export let content: string = '';
	export let placeholder: string = 'Start writing your article...';
	export let showToolbar: boolean = true;

	const dispatch = createEventDispatcher<{
		update: { html: string; wordCount: number };
	}>();

	let element: HTMLDivElement;
	let editor: Editor | null = null;
	let fileInput: HTMLInputElement;
	let videoFileInput: HTMLInputElement;
	let isUploading = false;
	let uploadError = '';
	let uploadType: 'image' | 'video' = 'image';

	// Word count from character count extension
	$: wordCount = editor?.storage.characterCount?.words() || 0;

	// ── Clipboard ─────────────────────────────────────────────────
	// What pasted plain text means in an article: each line is a
	// paragraph, an empty line is a blank paragraph, and the spaces and
	// tabs the text carries are kept as written — prosemirror collapses
	// them when it parses a paragraph.
	function sliceFromPlainText(text: string, view: EditorView): PMSlice {
		const normalized = text.replace(/\r\n?/g, '\n');
		const lines = normalized.split('\n');
		const el = document.createElement('div');
		el.innerHTML = lines
			// A blank line needs the line holder — an empty <p> does not
			// survive the parse, and the blank line was lost.
			.map((line) => `<p>${line === '' ? '<br>' : escapeHtml(line)}</p>`)
			.join('');
		const parsed = PMDOMParser.fromSchema(view.state.schema).parse(el, {
			preserveWhitespace: 'full'
		});
		// The first block is open, so it joins the line the caret sits on;
		// the last one merges with what follows. This is the shape
		// prosemirror's own pastes use — a slice of closed paragraphs
		// would not merge and would close into a split.
		return new PMSlice(parsed.content, 1, 1);
	}

	function escapeHtml(text: string): string {
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	// Copied HTML loses what the article cannot publish anyway: pictures
	// nobody uploaded (the toolbar upload is how a picture gets in),
	// scripts and their handlers, embedded documents.
	function stripUnpublishable(html: string): string {
		const parsed = new DOMParser().parseFromString(html, 'text/html');
		parsed
			.querySelectorAll('script, style, img, video, iframe, embed, object, source')
			.forEach((n) => n.remove());
		return parsed.body.innerHTML;
	}

	// A copy of this editor pastes back as its text, the way Notes pastes:
	// copying "hello" and pasting appends "hello", not a new paragraph.
	// The copied lines flatten to one paragraph of text with line breaks —
	// unless the copy holds a blank line, which is a paragraph boundary,
	// and then the copy stays paragraphs.
	function flattenToInline(slice: PMSlice, schema: PMSchema): PMSlice {
		if (!slice.content.size) return slice;
		let flatten = true;
		let holdsBlankLine = false;
		slice.content.forEach((node: PMNode) => {
			if (!node.isTextblock) flatten = false;
			if (node.isTextblock && node.content.size === 0) holdsBlankLine = true;
		});
		if (!flatten || holdsBlankLine) return slice;
		const parts: PMNode[] = [];
		let first = true;
		slice.content.forEach((node: PMNode) => {
			if (!first) parts.push(schema.nodes.hardBreak.create());
			first = false;
			node.content.forEach((child: PMNode) => parts.push(child));
		});
		return new PMSlice(PMFragment.fromArray(parts), 1, 1);
	}

	// Whether the caret sits in an empty paragraph: pasting there replaces
	// the paragraph, and going through replaceSelection on it leaves one
	// stray empty line after the pasted ones.
	function onEmptyLine(view: EditorView): boolean {
		const { $from, $to } = view.state.selection;
		return $from.parent.isTextblock && $from.parent.content.size === 0 && $from.sameParent($to);
	}

	onMount(() => {
		editor = new Editor({
			element,
			extensions: [
				StarterKit.configure({
					heading: {
						levels: [1, 2, 3]
					},
					link: false, // Disable bundled Link to use our custom config below
					// A pasted list is the end of what was pasted: prosemirror's
					// phantom paragraph after it published a blank line that
					// nobody typed.
					trailingNode: false
				}),
				Image.configure({
					HTMLAttributes: {
						class: 'article-image'
					},
					allowBase64: false
				}),
				Link.configure({
					openOnClick: false,
					HTMLAttributes: {
						class: 'article-link'
					}
				}),
				Mention.configure({
					HTMLAttributes: {
						class: 'mention'
					},
					suggestion: mentionSuggestion,
					renderText({ options, node }) {
						return `${options.suggestion?.char ?? '@'}${node.attrs.label ?? node.attrs.id}`;
					},
					renderHTML({ options, node }) {
						return [
							'span',
							{
								class: 'mention',
								'data-type': 'mention',
								'data-id': node.attrs.id,
								'data-label': node.attrs.label
							},
							`${options.suggestion?.char ?? '@'}${node.attrs.label ?? node.attrs.id}`
						];
					}
				}),
				Placeholder.configure({
					placeholder
				}),
				CharacterCount,
				// After Cmd-A an arrow key puts the caret at the selection's
				// edge, as in a plain editor — prosemirror's AllSelection does
				// not move with the arrow keys on its own, so copy, move, paste
				// pasted at the wrong end.
				Extension.create({
					name: 'selectAllCaret',
					addKeyboardShortcuts() {
						const collapse =
						(dir: 'start' | 'end') =>
						({ event }: { editor: Editor; event?: KeyboardEvent }) => {
							// Modified arrows (Shift to shrink the selection, Alt for
							// word moves) mean something else; only bare arrows
							// collapse a select-all to its edge.
							if (event && (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)) {
								return false;
							}
							const { view } = this.editor;
							const { selection, doc } = view.state;
							if (!(selection instanceof AllSelection) && !(selection instanceof NodeSelection)) {
								return false;
							}
							// Near() lands the caret inside the edge textblock — a
							// bare doc edge position (0 or doc.content.size) sits
							// outside the paragraph, where the next edit misbehaves.
							const pos = doc.resolve(dir === 'end' ? doc.content.size : 0);
							view.dispatch(
								view.state.tr.setSelection(TextSelection.near(pos, dir === 'end' ? -1 : 1))
							);
							return true;
						};
						return {
							ArrowRight: collapse('end'),
							ArrowLeft: collapse('start'),
							ArrowUp: collapse('start'),
							ArrowDown: collapse('end')
						};
					}
				})
			],
			content,
			onUpdate: ({ editor }) => {
				const html = editor.getHTML();
				const words = editor.storage.characterCount?.words() || 0;
				dispatch('update', { html, wordCount: words });
			},
			editorProps: {
				attributes: {
					class: 'prose prose-lg max-w-none focus:outline-none min-h-[400px]'
				},
				// A copy of this editor pastes back as its text (see flattenToInline).
				transformCopied: (slice) => flattenToInline(slice, editor?.state.schema as PMSchema),
				// The flattened copy is inline content, so prosemirror's clipboard
				// writer would leave the copy's marker off (it only marks an
				// element) and the paste would land as a new paragraph. Wrapping
				// the copy in a span gives the marker an element to sit on, and
				// the paste merges into the line, the way Notes pastes.
				clipboardSerializer: {
					serializeFragment: (fragment: PMFragment, options?: { document?: Document }) =>
						DOMSerializer.fromSchema((editor as Editor).state.schema).serializeFragment(
							fragment,
							options,
							document.createElement('span')
						)
				} as unknown as DOMSerializer,
				// The plain text of a copy keeps the blank line an empty
				// paragraph renders — prosemirror's default skips empty blocks,
				// so a copied blank line was lost on the way back in. A
				// flattened copy is inline content: its line breaks come from
				// the hard breaks, not block boundaries.
				clipboardTextSerializer: (slice) => {
					const leafText = (leaf: PMNode) =>
						leaf.type.name === 'hardBreak' ? '\n' : (leaf.text ?? '');
					const frag = slice.content;
					if (frag.firstChild && frag.firstChild.isInline) {
						return frag.textBetween(0, frag.size, '\n\n', leafText);
					}
					const parts: string[] = [];
					frag.forEach((node: PMNode) => {
						parts.push(node.textBetween(0, node.content.size, '\n', leafText));
					});
					// Blocks are one text line each: an empty paragraph is the
					// blank line it renders, so the copy's lines round-trip.
					return parts.join('\n');
				},
				// Copied or dropped HTML never carries what the article cannot
				// publish: unuploaded pictures, scripts, embedded documents.
				transformPastedHTML(html) {
					return stripUnpublishable(html);
				},
				// Pasted plain text keeps its lines, blank lines, spaces and tabs
				// (see sliceFromPlainText).
				clipboardTextParser: (text, $context, plain, view) => sliceFromPlainText(text, view),
				handleDrop: (view, event, slice, moved) => {
					// Handle image drops
					if (!moved && event.dataTransfer?.files?.length) {
						const images = Array.from(event.dataTransfer.files).filter((file) =>
							file.type.startsWith('image/')
						);
						if (images.length > 0) {
							event.preventDefault();
							handleImageFiles(images);
							return true;
						}
					}
					return false;
				},
				handlePaste: (view, event) => {
					// Handle image pastes
					const items = event.clipboardData?.items;
					if (items) {
						const images: File[] = [];
						for (const item of items) {
							if (item.type.startsWith('image/')) {
								const file = item.getAsFile();
								if (file) images.push(file);
							}
						}
						if (images.length > 0) {
							event.preventDefault();
							handleImageFiles(images);
							return true;
						}
					}
					const html = event.clipboardData?.getData('text/html') || '';
					const text = event.clipboardData?.getData('text/plain') || '';
					// A paste carrying this editor's own clipboard markers goes back
					// through the text it serialized, so a trailing space or a tab
					// survives the round trip the way Notes keeps them.
					if (html.includes('data-pm-slice') && text) {
						event.preventDefault();
						const slice = sliceFromPlainText(text, view);
						if (onEmptyLine(view)) {
							const { $from, $to } = view.state.selection;
							view.dispatch(view.state.tr.replaceWith($from.before(), $from.after(), slice.content));
						} else {
							view.dispatch(view.state.tr.replaceSelection(slice));
						}
						return true;
					}
					// A table in copied HTML has no markdown: it becomes the text a
					// reader would select from it — cells across a row with tabs,
					// rows one below the other.
					if (/<table[\s>]/i.test(html)) {
						event.preventDefault();
						const parsed = new DOMParser().parseFromString(html, 'text/html');
						const tableText = Array.from(parsed.querySelectorAll('tr'))
							.map((tr) =>
								Array.from(tr.querySelectorAll('td, th'))
									.map((cell) => (cell.textContent || '').trim())
									.join('\t')
							)
							.join('\n');
						view.dispatch(view.state.tr.replaceSelection(sliceFromPlainText(tableText, view)));
						return true;
					}
					// Copied HTML with real block structure (paragraphs, a list,
					// a heading, a quote) lands as those blocks. Prosemirror's
					// default fits it into the paragraph the caret sits in,
					// which mangles it into stray empty lines.
					if (html && /<(p|div|h[1-6]|ul|ol|blockquote|pre)[\s>]/i.test(html)) {
						event.preventDefault();
						const el = document.createElement('div');
						el.innerHTML = stripUnpublishable(html);
						const fragment = PMDOMParser.fromSchema(view.state.schema).parse(el, {
							preserveWhitespace: 'full'
						});
						const { $from, $to } = view.state.selection;
						if (onEmptyLine(view)) {
							view.dispatch(
								view.state.tr.replaceWith($from.before(), $from.after(), fragment.content)
							);
						} else {
							view.dispatch(view.state.tr.replaceSelection(new PMSlice(fragment.content, 0, 0)));
						}
						return true;
					}
					// Plain text onto an empty line replaces the line with the
					// pasted lines; replaceSelection on an empty line leaves one
					// stray empty line after them.
					if (!html && text && onEmptyLine(view)) {
						event.preventDefault();
						const slice = sliceFromPlainText(text, view);
						const { $from, $to } = view.state.selection;
						view.dispatch(view.state.tr.replaceWith($from.before(), $from.after(), slice.content));
						return true;
					}
					return false;
				}
			}
		});

		// Update element binding for Svelte
		editor.on('transaction', () => {
			editor = editor;
		});
	});

	onDestroy(() => {
		editor?.destroy();
	});

	// Upload image to nostr.build
	async function uploadToNostrBuild(file: File): Promise<string | null> {
		const body = new FormData();
		body.append('file[]', file);

		const url = 'https://nostr.build/api/v2/upload/files';
		const template = new NDKEvent($ndk);
		template.kind = 27235;
		template.created_at = Math.floor(Date.now() / 1000);
		template.content = '';
		template.tags = [
			['u', url],
			['method', 'POST']
		];

		await template.sign();

		const authEvent = {
			id: template.id,
			pubkey: template.pubkey,
			created_at: template.created_at,
			kind: template.kind,
			tags: template.tags,
			content: template.content,
			sig: template.sig
		};

		try {
			const result = await Fetch.fetchJson(url, {
				body,
				method: 'POST',
				headers: {
					Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`
				}
			});

			if (result && result.data && result.data[0]?.url) {
				return result.data[0].url;
			}
		} catch (error) {
			console.error('Upload failed:', error);
			throw error;
		}
		return null;
	}

	// Handle image file uploads
	async function handleImageFiles(files: File[]) {
		if (!editor || files.length === 0) return;

		isUploading = true;
		uploadType = 'image';
		uploadError = '';

		for (const file of files) {
			try {
				const imageUrl = await uploadToNostrBuild(file);
				if (imageUrl) {
					editor.chain().focus().setImage({ src: imageUrl }).run();
				}
			} catch (error) {
				console.error('Failed to upload image:', error);
				uploadError = 'Failed to upload image. Please try again.';
			}
		}

		isUploading = false;
	}

	// Handle video file uploads
	async function handleVideoFiles(files: File[]) {
		if (!editor || files.length === 0) return;

		isUploading = true;
		uploadType = 'video';
		uploadError = '';

		for (const file of files) {
			try {
				const videoUrl = await uploadToNostrBuild(file);
				if (videoUrl) {
					// Insert video as HTML since TipTap doesn't have native video support
					const videoHtml = `<video src="${videoUrl}" controls class="article-video" style="max-width: 100%; border-radius: 0.5rem; margin: 1rem 0;"></video>`;
					editor.chain().focus().insertContent(videoHtml).run();
				}
			} catch (error) {
				console.error('Failed to upload video:', error);
				uploadError = 'Failed to upload video. Please try again.';
			}
		}

		isUploading = false;
	}

	// Open file picker for image upload
	function openImagePicker() {
		fileInput?.click();
	}

	// Open file picker for video upload
	function openVideoPicker() {
		videoFileInput?.click();
	}

	// Handle image file input change
	function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files?.length) {
			const images = Array.from(target.files).filter((file) => file.type.startsWith('image/'));
			handleImageFiles(images);
			// Reset input
			target.value = '';
		}
	}

	// Handle video file input change
	function handleVideoFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files?.length) {
			const videos = Array.from(target.files).filter((file) => file.type.startsWith('video/'));
			handleVideoFiles(videos);
			// Reset input
			target.value = '';
		}
	}

	// Expose method to set content externally
	export function setContent(newContent: string) {
		if (editor && newContent !== editor.getHTML()) {
			editor.commands.setContent(newContent);
		}
	}

	// Expose method to get current content
	export function getContent(): string {
		return editor?.getHTML() || '';
	}

	// Expose method to focus editor
	export function focus() {
		editor?.commands.focus();
	}

	// Expose editor instance for external toolbar
	export function getEditor(): Editor | null {
		return editor;
	}

	// Expose image upload trigger for external toolbar
	export function triggerImageUpload() {
		openImagePicker();
	}

	// Expose video upload trigger for external toolbar
	export function triggerVideoUpload() {
		openVideoPicker();
	}
</script>

<div class="tiptap-editor" class:no-toolbar={!showToolbar}>
	<!-- Hidden file input for image uploads -->
	<input
		bind:this={fileInput}
		type="file"
		accept="image/*"
		multiple
		class="hidden"
		on:change={handleFileSelect}
	/>
	
	<!-- Hidden file input for video uploads -->
	<input
		bind:this={videoFileInput}
		type="file"
		accept="video/*"
		class="hidden"
		on:change={handleVideoFileSelect}
	/>

	<!-- Toolbar (can be hidden if using external toolbar) -->
	{#if showToolbar}
		<div class="toolbar-wrapper">
			<EditorToolbar {editor} onImageUpload={openImagePicker} />
		</div>
	{/if}
	
	<!-- Upload status (always shown) -->
	{#if isUploading}
		<div class="upload-status">
			<span class="upload-spinner" />
			Uploading {uploadType}...
		</div>
	{/if}

	{#if uploadError}
		<div class="upload-error">
			{uploadError}
		</div>
	{/if}

	<!-- Editor content area -->
	<div class="editor-content" bind:this={element} />
</div>

<style>
	.tiptap-editor {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.tiptap-editor.no-toolbar {
		gap: 0;
	}

	.hidden {
		display: none;
	}

	.toolbar-wrapper {
		position: sticky;
		top: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem 0;
		background: var(--color-bg-primary);
		margin-bottom: 0.75rem;
		border-bottom: 1px solid var(--color-input-border);
	}

	.upload-status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-action);
		color: var(--color-on-action);
		border-radius: 0.5rem;
		font-size: 0.875rem;
	}

	.upload-spinner {
		width: 1rem;
		height: 1rem;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.upload-error {
		padding: 0.5rem 0.75rem;
		background: #fee2e2;
		color: #dc2626;
		border-radius: 0.5rem;
		font-size: 0.875rem;
	}

	.editor-content {
		padding: 1.5rem;
		background: var(--color-input-bg);
		border: 1px solid var(--color-input-border);
		border-radius: 0.75rem;
		min-height: 400px;
	}

	/* Tiptap editor styles */
	.editor-content :global(.ProseMirror) {
		outline: none;
		min-height: 350px;
	}

	.editor-content :global(.ProseMirror p.is-editor-empty:first-child::before) {
		color: var(--color-text-secondary);
		content: attr(data-placeholder);
		float: left;
		height: 0;
		pointer-events: none;
	}

	/* Typography styles for editor content */
	.editor-content :global(h1) {
		font-size: 2rem;
		font-weight: 700;
		margin: 1.5rem 0 0.75rem;
		color: var(--color-text-primary);
		line-height: 1.2;
	}

	.editor-content :global(h2) {
		font-size: 1.5rem;
		font-weight: 600;
		margin: 1.25rem 0 0.625rem;
		color: var(--color-text-primary);
		line-height: 1.3;
	}

	.editor-content :global(h3) {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 1rem 0 0.5rem;
		color: var(--color-text-primary);
		line-height: 1.4;
	}

	.editor-content :global(p) {
		margin: 0.75rem 0;
		line-height: 1.75;
		color: var(--color-text-primary);
	}

	.editor-content :global(ul),
	.editor-content :global(ol) {
		margin: 0.75rem 0;
		padding-left: 1.5rem;
	}

	.editor-content :global(li) {
		margin: 0.25rem 0;
		line-height: 1.75;
	}

	.editor-content :global(blockquote) {
		margin: 1rem 0;
		padding: 0.5rem 1rem;
		border-left: 4px solid var(--color-primary);
		background: var(--color-input-bg);
		border-radius: 0 0.5rem 0.5rem 0;
		font-style: italic;
		color: var(--color-text-secondary);
	}

	.editor-content :global(pre) {
		margin: 1rem 0;
		padding: 1rem;
		background: var(--color-card-sunken);
		border-radius: 0.5rem;
		overflow-x: auto;
	}

	.editor-content :global(code) {
		font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
		font-size: 0.875rem;
		color: var(--color-text-primary);
	}

	.editor-content :global(p code) {
		padding: 0.125rem 0.375rem;
		background: var(--color-input-bg);
		border-radius: 0.25rem;
		color: var(--color-primary);
	}

	.editor-content :global(hr) {
		margin: 1.5rem 0;
		border: none;
		border-top: 2px solid var(--color-input-border);
	}

	.editor-content :global(.article-image) {
		max-width: 100%;
		height: auto;
		margin: 1rem 0;
		border-radius: 0.5rem;
	}

	.editor-content :global(.article-link) {
		color: var(--color-primary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.editor-content :global(.article-link:hover) {
		opacity: 0.8;
	}

	.editor-content :global(video),
	.editor-content :global(.article-video) {
		max-width: 100%;
		height: auto;
		margin: 1rem 0;
		border-radius: 0.5rem;
	}

	.editor-content :global(strong) {
		font-weight: 600;
	}

	.editor-content :global(em) {
		font-style: italic;
	}

	.editor-content :global(s) {
		text-decoration: line-through;
	}

	/* Mention pills */
	.editor-content :global(.mention) {
		background: var(--color-input-bg);
		color: var(--color-primary, #f97316);
		border-radius: 0.25rem;
		padding: 0.125rem 0.375rem;
		font-weight: 500;
		font-size: 0.9em;
		white-space: nowrap;
		cursor: default;
	}
</style>

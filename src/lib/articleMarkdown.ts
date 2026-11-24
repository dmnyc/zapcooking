import TurndownService from 'turndown';

// The markdown an article publishes (NIP-23): the editor's HTML through
// turndown, with mention spans back as their `nostr:` address. Lives here so
// the preview, the publish handler and the editor-matrix article surface all
// read the same function — what you see is what publishing delivers.

const turndownService = new TurndownService({
	headingStyle: 'atx',
	hr: '---',
	bulletListMarker: '-',
	codeBlockStyle: 'fenced'
});

// Custom rule: convert mention spans to nostr:npub1... format
turndownService.addRule('mention', {
	filter: (node: HTMLElement) => {
		return node.nodeName === 'SPAN' && node.getAttribute('data-type') === 'mention';
	},
	replacement: (_content: string, node: Node) => {
		const el = node as HTMLElement;
		const id = el.getAttribute('data-id') || '';
		return `nostr:${id}`;
	}
});

export function htmlToMarkdown(html: string): string {
	if (!html) return '';
	return turndownService.turndown(html);
}

import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './articleMarkdown';

describe('htmlToMarkdown', () => {
	it('keeps the blank line between paragraphs', () => {
		expect(htmlToMarkdown('<p>one</p><p>two</p>')).toBe('one\n\ntwo');
	});

	it('reads headings as ATX headings', () => {
		expect(htmlToMarkdown('<h2>Ingredients</h2>')).toBe('## Ingredients');
	});

	it('reads a mention span back as its nostr: address', () => {
		const npub = 'npub1' + 'q'.repeat(58);
		const html = `<span data-type="mention" data-id="${npub}">@Bea</span> liked this`;
		expect(htmlToMarkdown(html)).toBe(`nostr:${npub} liked this`);
	});

	it('reads a line break inside a paragraph as a markdown hard break', () => {
		// CommonMark: a hard break is two trailing spaces before the newline,
		// so a reader's markdown renderer keeps the line break.
		expect(htmlToMarkdown('<p>one<br>two</p>')).toBe('one  \ntwo');
	});

	it('reads no text from nothing', () => {
		expect(htmlToMarkdown('')).toBe('');
	});
});

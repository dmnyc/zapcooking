// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { isComposerEmpty, transferText } from './mentionUtils';

const editor = (html: string) => {
	const el = document.createElement('div');
	el.innerHTML = html;
	return el;
};

const transfer = (flavors: Record<string, string>) => ({
	getData: (type: string) => flavors[type] ?? ''
});

describe('isComposerEmpty', () => {
	it('reads a box holding nothing as empty', () => {
		expect(isComposerEmpty(editor(''))).toBe(true);
	});

	it('reads the line holder a browser leaves after deleting everything as empty', () => {
		expect(isComposerEmpty(editor('<br>'))).toBe(true);
		expect(isComposerEmpty(editor('<div><br></div>'))).toBe(true);
		expect(isComposerEmpty(editor('​'))).toBe(true);
	});

	it('reads a lone space as content', () => {
		expect(isComposerEmpty(editor(' '))).toBe(false);
	});

	it('reads two blank lines as content', () => {
		expect(isComposerEmpty(editor('<br><br>'))).toBe(false);
		expect(isComposerEmpty(editor('<div><br></div><div><br></div>'))).toBe(false);
	});

	it('reads a mention as content', () => {
		expect(
			isComposerEmpty(editor('​<span data-mention="nostr:npub1x" contenteditable="false"></span>​'))
		).toBe(false);
	});
});

describe('transferText', () => {
	it('prefers the plain text over rich text', () => {
		expect(transferText(transfer({ 'text/plain': 'bold', 'text/html': '<b>bold</b>' }))).toBe('bold');
	});

	it('reads an HTML-only clipboard as its text', () => {
		expect(transferText(transfer({ 'text/html': '<b>only html</b>' }))).toBe('only html');
	});

	it('reads nothing from an HTML picture and runs none of its handlers', () => {
		(window as unknown as { __pwned?: number }).__pwned = 0;
		expect(transferText(transfer({ 'text/html': '<img src=x onerror="window.__pwned=1">' }))).toBe('');
		expect((window as unknown as { __pwned?: number }).__pwned).toBe(0);
	});

	it('turns Windows line endings into \\n', () => {
		expect(transferText(transfer({ 'text/plain': 'one\r\ntwo\rthree' }))).toBe('one\ntwo\nthree');
	});

	it('reads this composer’s own pills back as their nostr: address', () => {
		const npub = 'npub1' + 'q'.repeat(58);
		const html = `hi ​<span class="mention-pill" data-mention="nostr:${npub}">@Bea</span>​ there`;
		expect(transferText(transfer({ 'text/plain': 'hi @Bea there', 'text/html': html }))).toBe(
			`hi nostr:${npub} there`
		);
	});

	it('keeps the lines of a copied multi-line selection, with no trailing newline', () => {
		expect(transferText(transfer({ 'text/html': 'ab<div><br></div><div>cd</div>' }))).toBe('ab\n\ncd');
	});

	it('keeps the blank line between pasted paragraphs of an HTML-only clipboard', () => {
		expect(transferText(transfer({ 'text/html': '<p>one</p><p>two</p>' }))).toBe('one\n\ntwo');
	});

	it('reads a line break inside a pasted paragraph as one line break', () => {
		expect(transferText(transfer({ 'text/html': '<p>one<br>two</p>' }))).toBe('one\ntwo');
	});

	it('an empty pasted paragraph is the blank line it renders', () => {
		expect(transferText(transfer({ 'text/html': '<p>ab</p><p><br></p><p>cd</p>' }))).toBe('ab\n\ncd');
	});

	it('reads an empty transfer as no text', () => {
		expect(transferText(null)).toBe('');
		expect(transferText(transfer({}))).toBe('');
	});
});

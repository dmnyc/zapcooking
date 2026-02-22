/**
 * Nostr Backup Service
 *
 * Backup/restore follows (kind:3), mute list (kind:10000), and profile (kind:0)
 * using NIP-78 (kind:30078) encrypted addressable events on Nostr relays.
 *
 * Profile backup reuses existing profileBackup.ts (rotating 3-slot system).
 * Follows and mute list use single replaceable events with fixed d-tags.
 */

import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk';
import { get } from 'svelte/store';
import { ndk, getCurrentRelays } from '$lib/nostr';
import { standardRelays } from '$lib/consts';
import {
	hasEncryptionSupport,
	encrypt,
	decrypt,
	detectEncryptionMethod,
	type EncryptionMethod
} from '$lib/encryptionService';
import { fetchMuteList, parseMuteListEvent, type MuteList } from '$lib/mutableIntegration';
import { resetCache as resetFollowListCache } from '$lib/followListCache';

// NIP-78 event kind
const APP_DATA_KIND = 30078;

// D-tag constants
const D_TAG_FOLLOWS = 'zapcooking:follows-backup';
const D_TAG_MUTE = 'zapcooking:mute-backup';

// Re-export profile backup d-tags for relay status checking
export const BACKUP_D_TAGS = {
	follows: D_TAG_FOLLOWS,
	mute: D_TAG_MUTE,
	// Profile uses rotating slots — checked separately via listProfileBackups
	profile: [
		'zapcooking:profile-backup:0',
		'zapcooking:profile-backup:1',
		'zapcooking:profile-backup:2',
		'zapcooking:profile-backup'
	]
} as const;

export type BackupType = 'follows' | 'mute' | 'profile';

// ── Data Structures ──

export interface FollowsBackupData {
	version: number;
	timestamp: number;
	follows: string[];
	relayHints?: Record<string, string>;
	kind3Content?: string;
}

export interface MuteBackupData {
	version: number;
	timestamp: number;
	muteList: {
		pubkeys: Array<{ value: string; reason?: string; private: boolean }>;
		words: Array<{ value: string; reason?: string; private: boolean }>;
		tags: Array<{ value: string; reason?: string; private: boolean }>;
		threads: Array<{ value: string; reason?: string; private: boolean }>;
	};
}

export interface RelayBackupStatus {
	relay: string;
	hasBackup: boolean;
	timestamp?: number;
	error?: string;
}

// ── Internal Helpers ──

async function encryptBackupData(
	data: FollowsBackupData | MuteBackupData,
	userPubkey: string
): Promise<{ content: string; method: EncryptionMethod }> {
	if (!hasEncryptionSupport()) {
		throw new Error('No encryption method available. Sign in with nsec, NIP-07, or NIP-46.');
	}
	const jsonString = JSON.stringify(data);
	const result = await encrypt(userPubkey, jsonString, 'nip04');
	return { content: result.ciphertext, method: result.method };
}

async function decryptBackupEvent<T>(event: NDKEvent): Promise<T | null> {
	const encryptedTag = event.tags.find((t) => t[0] === 'encrypted');
	const isEncrypted = encryptedTag?.[1] === 'true';

	if (isEncrypted) {
		if (!hasEncryptionSupport()) return null;
		const encMethodTag = event.tags.find((t) => t[0] === 'encryption');
		const method: EncryptionMethod =
			encMethodTag?.[1] === 'nip44' || encMethodTag?.[1] === 'nip04'
				? (encMethodTag[1] as EncryptionMethod)
				: detectEncryptionMethod(event.content);
		const decrypted = await decrypt(event.pubkey, event.content, method);
		return JSON.parse(decrypted) as T;
	} else {
		return JSON.parse(event.content) as T;
	}
}

async function publishBackupEvent(
	ndkInstance: NDK,
	dTag: string,
	content: string,
	isEncrypted: boolean,
	encryptionMethod: EncryptionMethod
): Promise<boolean> {
	const event = new NDKEvent(ndkInstance);
	event.kind = APP_DATA_KIND;
	event.content = content;
	event.tags = [
		['d', dTag],
		['encrypted', isEncrypted ? 'true' : 'false'],
		...(encryptionMethod ? [['encryption', encryptionMethod]] : [])
	];

	await event.sign();
	const publishedRelays = await event.publish();
	return publishedRelays.size > 0;
}

function getRelayUrls(): string[] {
	const relays = getCurrentRelays();
	return Array.isArray(relays) && relays.length > 0 ? relays : standardRelays;
}

// ── Follows Backup ──

export async function backupFollows(
	ndkInstance: NDK,
	pubkey: string
): Promise<boolean> {
	// Fetch current kind:3
	const event = await ndkInstance.fetchEvent({
		kinds: [3],
		authors: [pubkey]
	});

	if (!event) {
		throw new Error('No follow list found to back up');
	}

	// Extract follows and relay hints
	const follows: string[] = [];
	const relayHints: Record<string, string> = {};

	for (const tag of event.tags) {
		if (tag[0] === 'p' && tag[1]) {
			follows.push(tag[1]);
			if (tag[2]) {
				relayHints[tag[1]] = tag[2];
			}
		}
	}

	const backupData: FollowsBackupData = {
		version: 1,
		timestamp: Date.now(),
		follows,
		relayHints: Object.keys(relayHints).length > 0 ? relayHints : undefined,
		kind3Content: event.content || undefined
	};

	// Encrypt and publish
	const { content, method } = await encryptBackupData(backupData, pubkey);
	return publishBackupEvent(ndkInstance, D_TAG_FOLLOWS, content, true, method);
}

export async function fetchFollowsBackup(
	ndkInstance: NDK,
	pubkey: string
): Promise<FollowsBackupData | null> {
	const events = await ndkInstance.fetchEvents({
		kinds: [APP_DATA_KIND],
		authors: [pubkey],
		'#d': [D_TAG_FOLLOWS]
	});

	if (!events || events.size === 0) return null;

	const latest = Array.from(events).sort(
		(a, b) => (b.created_at || 0) - (a.created_at || 0)
	)[0];

	return decryptBackupEvent<FollowsBackupData>(latest);
}

export async function restoreFollowsFromBackup(
	ndkInstance: NDK,
	pubkey: string,
	backup: FollowsBackupData
): Promise<boolean> {
	const event = new NDKEvent(ndkInstance);
	event.kind = 3;
	event.content = backup.kind3Content || '';
	event.tags = backup.follows.map((pk) => {
		const tag = ['p', pk];
		if (backup.relayHints?.[pk]) {
			tag.push(backup.relayHints[pk]);
		}
		return tag;
	});

	await event.sign();
	const publishedRelays = await event.publish();

	if (publishedRelays.size > 0) {
		// Invalidate follow list cache
		resetFollowListCache();
		return true;
	}
	return false;
}

// ── Mute List Backup ──

export async function backupMuteList(
	ndkInstance: NDK,
	pubkey: string
): Promise<boolean> {
	// Fetch current kind:10000
	const event = await fetchMuteList(pubkey);
	if (!event) {
		throw new Error('No mute list found to back up');
	}

	const muteList = await parseMuteListEvent(event);

	const backupData: MuteBackupData = {
		version: 1,
		timestamp: Date.now(),
		muteList: {
			pubkeys: muteList.pubkeys.map((p) => ({
				value: p.value,
				reason: p.reason,
				private: p.private || false
			})),
			words: muteList.words.map((w) => ({
				value: w.value,
				reason: w.reason,
				private: w.private || false
			})),
			tags: muteList.tags.map((t) => ({
				value: t.value,
				reason: t.reason,
				private: t.private || false
			})),
			threads: muteList.threads.map((t) => ({
				value: t.value,
				reason: t.reason,
				private: t.private || false
			}))
		}
	};

	const { content, method } = await encryptBackupData(backupData, pubkey);
	return publishBackupEvent(ndkInstance, D_TAG_MUTE, content, true, method);
}

export async function fetchMuteListBackup(
	ndkInstance: NDK,
	pubkey: string
): Promise<MuteBackupData | null> {
	const events = await ndkInstance.fetchEvents({
		kinds: [APP_DATA_KIND],
		authors: [pubkey],
		'#d': [D_TAG_MUTE]
	});

	if (!events || events.size === 0) return null;

	const latest = Array.from(events).sort(
		(a, b) => (b.created_at || 0) - (a.created_at || 0)
	)[0];

	return decryptBackupEvent<MuteBackupData>(latest);
}

export async function restoreMuteListFromBackup(
	ndkInstance: NDK,
	pubkey: string,
	backup: MuteBackupData
): Promise<boolean> {
	const event = new NDKEvent(ndkInstance);
	event.kind = 10000;
	event.tags = [];

	// Public items go in tags
	const privateItems: {
		pubkeys?: Array<{ type: string; value: string; reason?: string }>;
		words?: Array<{ type: string; value: string; reason?: string }>;
		tags?: Array<{ type: string; value: string; reason?: string }>;
		threads?: Array<{ type: string; value: string; reason?: string }>;
	} = {};

	for (const p of backup.muteList.pubkeys) {
		if (p.private) {
			if (!privateItems.pubkeys) privateItems.pubkeys = [];
			privateItems.pubkeys.push({ type: 'pubkey', value: p.value, reason: p.reason });
		} else {
			const tag = ['p', p.value];
			if (p.reason) tag.push(p.reason);
			event.tags.push(tag);
		}
	}

	for (const w of backup.muteList.words) {
		if (w.private) {
			if (!privateItems.words) privateItems.words = [];
			privateItems.words.push({ type: 'word', value: w.value, reason: w.reason });
		} else {
			const tag = ['word', w.value];
			if (w.reason) tag.push(w.reason);
			event.tags.push(tag);
		}
	}

	for (const t of backup.muteList.tags) {
		if (t.private) {
			if (!privateItems.tags) privateItems.tags = [];
			privateItems.tags.push({ type: 'tag', value: t.value, reason: t.reason });
		} else {
			const tag = ['t', t.value];
			if (t.reason) tag.push(t.reason);
			event.tags.push(tag);
		}
	}

	for (const t of backup.muteList.threads) {
		if (t.private) {
			if (!privateItems.threads) privateItems.threads = [];
			privateItems.threads.push({ type: 'thread', value: t.value, reason: t.reason });
		} else {
			const tag = ['e', t.value];
			if (t.reason) tag.push(t.reason);
			event.tags.push(tag);
		}
	}

	// Private items go encrypted in content
	const hasPrivateItems = Object.values(privateItems).some((arr) => arr && arr.length > 0);
	if (hasPrivateItems && hasEncryptionSupport()) {
		const { ciphertext } = await encrypt(pubkey, JSON.stringify(privateItems), 'nip04');
		event.content = ciphertext;
	} else {
		event.content = '';
	}

	await event.sign();
	const publishedRelays = await event.publish();

	if (publishedRelays.size > 0) {
		// Invalidate mute list store — import dynamically to avoid circular deps
		const { muteListStore } = await import('$lib/muteListStore');
		muteListStore.load(true);
		return true;
	}
	return false;
}

// ── Per-Relay Status Check ──

export async function checkBackupRelayStatus(
	ndkInstance: NDK,
	pubkey: string,
	dTags: string | string[],
	relayUrls?: string[]
): Promise<RelayBackupStatus[]> {
	const relays = relayUrls || getRelayUrls();
	const dTagArray = Array.isArray(dTags) ? dTags : [dTags];

	const checkPromises = relays.map(async (relayUrl): Promise<RelayBackupStatus> => {
		try {
			const relaySet = NDKRelaySet.fromRelayUrls([relayUrl], ndkInstance, true);

			const events = await Promise.race([
				ndkInstance.fetchEvents(
					{
						kinds: [APP_DATA_KIND],
						authors: [pubkey],
						'#d': dTagArray
					},
					{ closeOnEose: true },
					relaySet
				),
				new Promise<Set<NDKEvent>>((resolve) => setTimeout(() => resolve(new Set()), 8000))
			]);

			if (events && events.size > 0) {
				let latest: NDKEvent | null = null;
				for (const event of events) {
					if (!latest || (event.created_at || 0) > (latest.created_at || 0)) {
						latest = event;
					}
				}

				return {
					relay: relayUrl,
					hasBackup: true,
					timestamp: latest?.created_at ? latest.created_at * 1000 : undefined
				};
			}

			return { relay: relayUrl, hasBackup: false };
		} catch {
			return { relay: relayUrl, hasBackup: false, error: 'Connection failed' };
		}
	});

	return Promise.all(checkPromises);
}

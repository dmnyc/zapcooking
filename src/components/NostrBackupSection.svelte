<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { ndk, userPublickey } from '$lib/nostr';
	import { hasEncryptionSupport } from '$lib/encryptionService';
	import {
		backupFollows,
		fetchFollowsBackup,
		restoreFollowsFromBackup,
		backupMuteList,
		fetchMuteListBackup,
		restoreMuteListFromBackup,
		checkBackupRelayStatus,
		BACKUP_D_TAGS,
		type BackupType,
		type FollowsBackupData,
		type MuteBackupData,
		type RelayBackupStatus
	} from '$lib/nostrBackup';
	import {
		backupProfile,
		fetchProfileBackup,
		restoreProfileFromBackup,
		listProfileBackups,
		type ProfileBackupData
	} from '$lib/profileBackup';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
	import XCircleIcon from 'phosphor-svelte/lib/XCircle';
	import WarningIcon from 'phosphor-svelte/lib/Warning';
	import CloudArrowUpIcon from 'phosphor-svelte/lib/CloudArrowUp';
	import CloudArrowDownIcon from 'phosphor-svelte/lib/CloudArrowDown';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwise';

	// ── State ──

	interface BackupStatus {
		exists: boolean;
		timestamp: number | null;
		relayStatuses: RelayBackupStatus[];
		loading: boolean;
		error: string | null;
		itemCount?: number;
	}

	let statuses: Record<BackupType, BackupStatus> = {
		follows: { exists: false, timestamp: null, relayStatuses: [], loading: false, error: null },
		mute: { exists: false, timestamp: null, relayStatuses: [], loading: false, error: null },
		profile: { exists: false, timestamp: null, relayStatuses: [], loading: false, error: null }
	};

	let backingUp: Record<BackupType, boolean> = { follows: false, mute: false, profile: false };
	let restoring: Record<BackupType, boolean> = { follows: false, mute: false, profile: false };
	let messages: Record<BackupType, { text: string; type: 'success' | 'error' } | null> = {
		follows: null,
		mute: null,
		profile: null
	};
	let expandedType: BackupType | null = null;

	// Cached backup data for restore
	let followsBackup: FollowsBackupData | null = null;
	let muteBackup: MuteBackupData | null = null;
	let profileBackup: ProfileBackupData | null = null;

	$: canEncrypt = browser ? hasEncryptionSupport() : false;

	// ── Lifecycle ──

	onMount(async () => {
		if (!browser || !$userPublickey) return;
		await checkAllStatuses();
	});

	// ── Status Checks ──

	async function checkAllStatuses() {
		await Promise.all([checkFollowsStatus(), checkMuteStatus(), checkProfileStatus()]);
	}

	async function checkFollowsStatus() {
		statuses.follows.loading = true;
		statuses.follows.error = null;
		statuses = statuses;

		try {
			// Fetch backup data
			followsBackup = await fetchFollowsBackup($ndk, $userPublickey);

			// Check per-relay status
			const relayStatuses = await checkBackupRelayStatus(
				$ndk,
				$userPublickey,
				BACKUP_D_TAGS.follows
			);

			statuses.follows = {
				exists: followsBackup !== null,
				timestamp: followsBackup?.timestamp || null,
				relayStatuses,
				loading: false,
				error: null,
				itemCount: followsBackup?.follows.length
			};
		} catch (e: any) {
			statuses.follows.loading = false;
			statuses.follows.error = e.message || 'Failed to check follows backup';
		}
		statuses = statuses;
	}

	async function checkMuteStatus() {
		statuses.mute.loading = true;
		statuses.mute.error = null;
		statuses = statuses;

		try {
			muteBackup = await fetchMuteListBackup($ndk, $userPublickey);

			const relayStatuses = await checkBackupRelayStatus(
				$ndk,
				$userPublickey,
				BACKUP_D_TAGS.mute
			);

			const itemCount = muteBackup
				? muteBackup.muteList.pubkeys.length +
					muteBackup.muteList.words.length +
					muteBackup.muteList.tags.length +
					muteBackup.muteList.threads.length
				: undefined;

			statuses.mute = {
				exists: muteBackup !== null,
				timestamp: muteBackup?.timestamp || null,
				relayStatuses,
				loading: false,
				error: null,
				itemCount
			};
		} catch (e: any) {
			statuses.mute.loading = false;
			statuses.mute.error = e.message || 'Failed to check mute list backup';
		}
		statuses = statuses;
	}

	async function checkProfileStatus() {
		statuses.profile.loading = true;
		statuses.profile.error = null;
		statuses = statuses;

		try {
			// List all profile backups (rotating slots)
			const backups = await listProfileBackups($ndk, $userPublickey);
			profileBackup = backups.length > 0 && backups[0].data ? backups[0].data : null;

			const relayStatuses = await checkBackupRelayStatus(
				$ndk,
				$userPublickey,
				BACKUP_D_TAGS.profile as unknown as string[]
			);

			statuses.profile = {
				exists: backups.length > 0,
				timestamp: backups.length > 0 ? backups[0].timestamp : null,
				relayStatuses,
				loading: false,
				error: null,
				itemCount: backups.length
			};
		} catch (e: any) {
			statuses.profile.loading = false;
			statuses.profile.error = e.message || 'Failed to check profile backup';
		}
		statuses = statuses;
	}

	// ── Backup Actions ──

	async function handleBackup(type: BackupType) {
		backingUp[type] = true;
		messages[type] = null;

		try {
			switch (type) {
				case 'follows':
					await backupFollows($ndk, $userPublickey);
					break;
				case 'mute':
					await backupMuteList($ndk, $userPublickey);
					break;
				case 'profile': {
					const profileEvent = await $ndk.fetchEvent({
						kinds: [0],
						authors: [$userPublickey]
					});
					if (profileEvent) {
						await backupProfile($ndk, $userPublickey, JSON.parse(profileEvent.content));
					} else {
						throw new Error('No profile found to back up');
					}
					break;
				}
			}
			messages[type] = { text: 'Backup created successfully', type: 'success' };
			// Refresh status for this type
			switch (type) {
				case 'follows':
					await checkFollowsStatus();
					break;
				case 'mute':
					await checkMuteStatus();
					break;
				case 'profile':
					await checkProfileStatus();
					break;
			}
		} catch (e: any) {
			messages[type] = { text: e.message || 'Backup failed', type: 'error' };
		} finally {
			backingUp[type] = false;
		}
	}

	// ── Restore Actions ──

	async function handleRestore(type: BackupType) {
		const labels: Record<BackupType, string> = {
			follows: 'follow list',
			mute: 'mute list',
			profile: 'profile'
		};
		if (!confirm(`Restore your ${labels[type]} from backup? This will replace your current ${labels[type]}.`))
			return;

		restoring[type] = true;
		messages[type] = null;

		try {
			switch (type) {
				case 'follows':
					if (!followsBackup) {
						followsBackup = await fetchFollowsBackup($ndk, $userPublickey);
					}
					if (followsBackup) {
						await restoreFollowsFromBackup($ndk, $userPublickey, followsBackup);
					} else {
						throw new Error('No backup found to restore');
					}
					break;
				case 'mute':
					if (!muteBackup) {
						muteBackup = await fetchMuteListBackup($ndk, $userPublickey);
					}
					if (muteBackup) {
						await restoreMuteListFromBackup($ndk, $userPublickey, muteBackup);
					} else {
						throw new Error('No backup found to restore');
					}
					break;
				case 'profile':
					if (!profileBackup) {
						profileBackup = await fetchProfileBackup($ndk, $userPublickey);
					}
					if (profileBackup) {
						await restoreProfileFromBackup($ndk, $userPublickey, profileBackup);
					} else {
						throw new Error('No backup found to restore');
					}
					break;
			}
			messages[type] = { text: 'Restored successfully', type: 'success' };
		} catch (e: any) {
			messages[type] = { text: e.message || 'Restore failed', type: 'error' };
		} finally {
			restoring[type] = false;
		}
	}

	// ── Helpers ──

	function toggleRelayDetails(type: BackupType) {
		expandedType = expandedType === type ? null : type;
	}

	function formatTimestamp(ts: number | null): string {
		if (!ts) return '';
		const date = new Date(ts);
		const now = Date.now();
		const diff = now - ts;

		if (diff < 60 * 1000) return 'just now';
		if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
		if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h ago`;
		if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}d ago`;
		return date.toLocaleDateString();
	}

	function formatRelayTimestamp(ts: number | undefined): string {
		if (!ts) return '';
		return new Date(ts).toLocaleDateString();
	}

	function getRelayDisplayName(relayUrl: string): string {
		try {
			return new URL(relayUrl).hostname;
		} catch {
			return relayUrl;
		}
	}

	function relayBackupCount(statuses: RelayBackupStatus[]): number {
		return statuses.filter((r) => r.hasBackup).length;
	}

	const typeLabels: Record<BackupType, { label: string; kind: string; description: string }> = {
		follows: { label: 'Follows', kind: 'kind:3', description: 'Your contact list' },
		mute: { label: 'Mute List', kind: 'kind:10000', description: 'Muted users, words, and tags' },
		profile: { label: 'Profile', kind: 'kind:0', description: 'Display name, bio, picture, etc.' }
	};

	const types: BackupType[] = ['follows', 'mute', 'profile'];
</script>

<div class="flex flex-col gap-4">
	<p class="text-xs text-caption">
		Back up your social graph to Nostr relays using encrypted NIP-78 events. Only you can decrypt
		these backups.
	</p>

	{#if !canEncrypt}
		<div
			class="p-3 rounded-lg flex items-center gap-2 text-sm"
			style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); color: var(--color-text-primary);"
		>
			<WarningIcon size={18} class="text-amber-500 flex-shrink-0" />
			<span class="text-xs"
				>Encryption is required for backups. Sign in with nsec, NIP-07, or NIP-46 to enable.</span
			>
		</div>
	{/if}

	{#each types as type}
		{@const status = statuses[type]}
		{@const info = typeLabels[type]}
		{@const hasRelays = status.relayStatuses.length > 0}
		{@const backupRelays = relayBackupCount(status.relayStatuses)}

		<div
			class="rounded-lg border overflow-hidden"
			style="border-color: var(--color-input-border); background-color: var(--color-bg-primary);"
		>
			<!-- Header -->
			<div class="px-4 py-3">
				<div class="flex items-center justify-between mb-1">
					<div class="flex items-center gap-2">
						<span class="text-sm font-medium" style="color: var(--color-text-primary)"
							>{info.label}</span
						>
						<span class="text-xs text-caption font-mono">{info.kind}</span>
					</div>
				</div>

				<!-- Status line -->
				<div class="flex items-center gap-1.5 mb-3">
					{#if status.loading}
						<div
							class="w-3 h-3 border-2 border-primary-color border-t-transparent rounded-full animate-spin"
						></div>
						<span class="text-xs text-caption">Checking...</span>
					{:else if status.error}
						<WarningIcon size={14} class="text-amber-500" />
						<span class="text-xs text-amber-500">{status.error}</span>
					{:else if status.exists}
						<CheckCircleIcon size={14} class="text-green-500" weight="fill" />
						<span class="text-xs text-caption">
							{#if type === 'profile' && status.itemCount}
								{status.itemCount} backup{status.itemCount !== 1 ? 's' : ''}
							{:else if status.itemCount !== undefined}
								{status.itemCount} items backed up
							{:else}
								Backed up
							{/if}
							{#if status.timestamp}
								&middot; {formatTimestamp(status.timestamp)}
							{/if}
							{#if hasRelays}
								&middot; {backupRelays}/{status.relayStatuses.length} relays
							{/if}
						</span>
					{:else}
						<XCircleIcon size={14} class="text-caption" />
						<span class="text-xs text-caption">No backup found</span>
					{/if}
				</div>

				<!-- Actions -->
				<div class="flex items-center gap-2">
					<button
						class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
						style="background-color: var(--color-primary); color: #ffffff;"
						disabled={!canEncrypt || backingUp[type]}
						on:click={() => handleBackup(type)}
					>
						{#if backingUp[type]}
							<div
								class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"
							></div>
							Backing up...
						{:else}
							<CloudArrowUpIcon size={14} />
							Backup Now
						{/if}
					</button>

					<button
						class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
						style="background-color: var(--color-bg-secondary); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
						disabled={!status.exists || !canEncrypt || restoring[type]}
						on:click={() => handleRestore(type)}
					>
						{#if restoring[type]}
							<div
								class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"
							></div>
							Restoring...
						{:else}
							<CloudArrowDownIcon size={14} />
							Restore
						{/if}
					</button>

					{#if hasRelays}
						<button
							class="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors hover:bg-[var(--color-bg-secondary)]"
							style="color: var(--color-caption);"
							on:click={() => toggleRelayDetails(type)}
						>
							<CaretDownIcon
								size={12}
								class="transition-transform duration-200 {expandedType === type
									? 'rotate-180'
									: ''}"
							/>
							Relays
						</button>
					{/if}
				</div>

				<!-- Message -->
				{#if messages[type]}
					<div
						class="mt-2 text-xs px-2 py-1 rounded"
						class:text-green-600={messages[type]?.type === 'success'}
						class:text-red-500={messages[type]?.type === 'error'}
						style="background-color: {messages[type]?.type === 'success'
							? 'rgba(34, 197, 94, 0.1)'
							: 'rgba(239, 68, 68, 0.1)'};"
					>
						{messages[type]?.text}
					</div>
				{/if}
			</div>

			<!-- Relay Details (expandable) -->
			{#if expandedType === type && hasRelays}
				<div
					class="px-4 pb-3 pt-2 border-t flex flex-col gap-1.5"
					style="border-color: var(--color-input-border);"
				>
					{#each status.relayStatuses as relay}
						<div class="flex items-center justify-between text-xs">
							<div class="flex items-center gap-1.5 min-w-0">
								{#if relay.hasBackup}
									<CheckCircleIcon size={12} class="text-green-500 flex-shrink-0" weight="fill" />
								{:else if relay.error}
									<WarningIcon size={12} class="text-amber-500 flex-shrink-0" weight="fill" />
								{:else}
									<XCircleIcon size={12} class="text-caption flex-shrink-0" />
								{/if}
								<span class="truncate font-mono text-caption"
									>{getRelayDisplayName(relay.relay)}</span
								>
							</div>
							<span class="text-caption flex-shrink-0 ml-2">
								{#if relay.hasBackup && relay.timestamp}
									{formatRelayTimestamp(relay.timestamp)}
								{:else if relay.error}
									<span class="text-amber-500">{relay.error}</span>
								{:else}
									—
								{/if}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/each}

	<!-- Refresh all -->
	<button
		class="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs transition-colors hover:opacity-80"
		style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
		on:click={checkAllStatuses}
		disabled={statuses.follows.loading || statuses.mute.loading || statuses.profile.loading}
	>
		<ArrowClockwiseIcon
			size={14}
			class={statuses.follows.loading || statuses.mute.loading || statuses.profile.loading
				? 'animate-spin'
				: ''}
		/>
		Refresh All
	</button>
</div>

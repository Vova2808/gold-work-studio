/** Public YouTube counters, not private YouTube Analytics or estimated earnings. */
export interface ChannelAnalyticsSnapshot {
  capturedAt: string;
  views: number | null;
  subscribers: number | null;
  videos: number | null;
}

export interface PublicYouTubeChannelStats {
  channelId: string;
  title: string;
  views: number | null;
  subscribers: number | null;
  videos: number | null;
}

export interface TrackedYouTubeChannel {
  id: string;
  url: string;
  name: string;
  group: string;
  channelId?: string;
  youtubeTitle?: string;
  addedAt: string;
  lastAttemptAt?: string;
  lastError?: string;
  snapshots: ChannelAnalyticsSnapshot[];
}

export interface SaveTrackedChannelInput {
  id?: string;
  url: string;
  name: string;
  group?: string;
}

export const ANALYTICS_AUTO_REFRESH_MS = 6 * 60 * 60 * 1000;
export const ANALYTICS_MANUAL_REFRESH_MS = 15 * 60 * 1000;

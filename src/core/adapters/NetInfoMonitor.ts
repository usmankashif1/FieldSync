import NetInfo from '@react-native-community/netinfo';
import type { NetworkMonitor } from '../queue/types';

export class NetInfoMonitor implements NetworkMonitor {
  private online = false;
  private eventVersion = 0;
  private readonly listeners = new Set<(online: boolean) => void>();
  private readonly unsubscribe: () => void;

  constructor() {
    this.unsubscribe = NetInfo.addEventListener(state => {
      this.eventVersion += 1;
      this.setOnline(state.isConnected === true);
    });
  }

  isOnline(): boolean {
    return this.online;
  }

  onChange(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<void> {
    const versionBeforeFetch = this.eventVersion;
    const state = await NetInfo.fetch();
    if (versionBeforeFetch === this.eventVersion) {
      this.setOnline(state.isConnected === true);
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  private setOnline(online: boolean): void {
    if (this.online === online) {
      return;
    }
    this.online = online;
    this.listeners.forEach(listener => listener(online));
  }
}

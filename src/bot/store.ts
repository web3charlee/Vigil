import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface UserRecord {
  id: number;
  maxRisk: number; // block threshold, 0..100
  referredBy: number | null;
  createdAt: number;
  scans: number;
}

export const DEFAULT_MAX_RISK = 60;

/** Small JSON-file store. Fine for the first few thousand users; swap for Postgres later. */
export class UserStore {
  private users = new Map<number, UserRecord>();
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private file: string | null) {
    if (file && existsSync(file)) {
      try {
        const rows = JSON.parse(readFileSync(file, 'utf8')) as UserRecord[];
        for (const r of rows) this.users.set(r.id, r);
      } catch (e) {
        console.error('Could not read user store, starting empty:', e);
      }
    }
  }

  has(id: number): boolean {
    return this.users.has(id);
  }

  get(id: number): UserRecord {
    let u = this.users.get(id);
    if (!u) {
      u = { id, maxRisk: DEFAULT_MAX_RISK, referredBy: null, createdAt: Date.now(), scans: 0 };
      this.users.set(id, u);
      this.scheduleSave();
    }
    return u;
  }

  setMaxRisk(id: number, maxRisk: number): void {
    this.get(id).maxRisk = Math.max(0, Math.min(100, Math.round(maxRisk)));
    this.scheduleSave();
  }

  incrementScans(id: number): void {
    this.get(id).scans += 1;
    this.scheduleSave();
  }

  /** Only sets the referrer for brand-new users, never for yourself, never twice. */
  registerStart(id: number, referrerId: number | null): { isNew: boolean } {
    const isNew = !this.users.has(id);
    const u = this.get(id);
    if (isNew && referrerId !== null && referrerId !== id && this.users.has(referrerId)) {
      u.referredBy = referrerId;
      this.scheduleSave();
    }
    return { isNew };
  }

  referralCount(id: number): number {
    let n = 0;
    for (const u of this.users.values()) if (u.referredBy === id) n++;
    return n;
  }

  stats(): { users: number; scans: number; referred: number } {
    let scans = 0;
    let referred = 0;
    for (const u of this.users.values()) {
      scans += u.scans;
      if (u.referredBy !== null) referred++;
    }
    return { users: this.users.size, scans, referred };
  }

  private scheduleSave(): void {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 1000);
  }

  async flush(): Promise<void> {
    if (!this.file) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const file = this.file;
    const data = JSON.stringify([...this.users.values()]);
    // Serialize writes; write to a temp file then rename so a crash can't corrupt the store.
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, data);
      await rename(`${file}.tmp`, file);
    });
    await this.writing;
  }
}

import { z } from 'zod';
import { insertZshrcBlock } from '../src/lib/applyConfig.js';
import { groupConfigs, readActive, findActiveIndex } from '../src/lib/configModel.js';
import {
  applySchema, changeSchemas, expectedSchema, writeIdentitySchema,
} from '../src/lib/configIpcContract.js';
import type { ConfigEntry } from '../src/lib/applyConfig.js';
import type { ConfigState } from '../src/lib/configContract.js';
import type { FileStore } from './files.js';
import { FileStoreError, type FileErrorCode } from './errors.js';

const IDENTITY = ['model', 'base_url', 'key'] as const;
const diskSchema = z.array(z.looseObject({
  ...expectedSchema.shape,
  channel: z.string().optional(),
}));

function validate<S extends z.ZodType>(
  schema: S, value: unknown, code: FileErrorCode = 'INVALID_REQUEST',
): z.infer<S> {
  if (!schema.safeParse(value).success) throw new FileStoreError(code);
  return value as z.infer<S>;
}

function parseEntries(text: string) {
  let entries: unknown;
  try {
    entries = JSON.parse(text);
  } catch {
    throw new FileStoreError('INVALID_CONFIG');
  }
  return validate(diskSchema, entries, 'INVALID_CONFIG');
}

function identity(entry: Pick<ConfigEntry, 'model' | 'base_url' | 'key'>) {
  return { model: entry.model, base_url: entry.base_url, key: entry.key };
}

function expose(entry: z.infer<typeof diskSchema>[number]): ConfigEntry {
  return { ...identity(entry), channel: entry.channel ?? '' };
}

export function createService(store: FileStore) {
  return Object.freeze({
    async state(): Promise<ConfigState> {
      const [config, settings, zshrc] = await Promise.all([
        store.read('config'), store.read('settings'), store.read('zshrc'),
      ]);
      const entries = parseEntries(config).map(expose);
      return {
        entries,
        groups: groupConfigs(entries),
        activeIndex: findActiveIndex(entries, readActive(settings, zshrc)),
      };
    },

    async apply(body: unknown): Promise<void> {
      const data = validate(applySchema, body);
      await store.update('zshrc', async (text, readDependency) => {
        const entries = parseEntries(await readDependency('config')).map(expose);
        const index = findActiveIndex(entries, {
          model: data.expected.model,
          url: data.expected.base_url,
          key: data.expected.key,
        });
        if (index < 0) throw new FileStoreError('CONFLICT');
        const entry = entries[index];
        validate(writeIdentitySchema, identity(entry), 'INVALID_CONFIG');
        return insertZshrcBlock(text, entry);
      });
    },

    async change(
      method: keyof typeof changeSchemas, index: number | undefined, body: unknown,
    ): Promise<void> {
      const data = validate(changeSchemas[method], body);
      await store.update('config', text => {
        const entries = parseEntries(text);
        if ('expected' in data
            && !IDENTITY.every(key => entries[index!]?.[key] === data.expected[key])) {
          throw new FileStoreError('CONFLICT');
        }
        const next = 'entry' in data
          ? method === 'POST' ? [...entries, data.entry]
            : entries.map((entry, position) => position === index ? data.entry : entry)
          : entries.filter((_, position) => position !== index);
        return `${JSON.stringify(next, null, 4)}\n`;
      });
    },
  });
}

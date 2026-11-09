import { z } from 'zod';
import {
  insertZshrcBlock, groupConfigs, readActive, findActiveIndex,
} from '../dist-server/domain.mjs';
import { FileStoreError } from './errors.mjs';

const IDENTITY = ['model', 'base_url', 'key'];
const identityFields = {
  model: z.string(),
  base_url: z.string(),
  key: z.string(),
};
const text = z.string().refine(value =>
  !/[\x00-\x1f\x7f-\x9f]/.test(value)
    && Buffer.from(value, 'utf8').toString('utf8') === value);
const requiredText = text.refine(value => value.trim().length > 0);
const writeFields = {
  model: requiredText,
  base_url: requiredText,
  key: requiredText,
};
const expectedSchema = z.strictObject(identityFields);
const writeIdentitySchema = z.strictObject(writeFields);
const entrySchema = z.strictObject({ ...writeFields, channel: text });
const diskSchema = z.array(z.looseObject({
  ...identityFields,
  channel: z.string().optional(),
}));
const applySchema = z.strictObject({ expected: expectedSchema });
const changeSchemas = Object.freeze({
  POST: z.strictObject({ entry: entrySchema }),
  PATCH: z.strictObject({ expected: expectedSchema, entry: entrySchema }),
  DELETE: z.strictObject({ expected: expectedSchema }),
});

function validate(schema, value, code = 'INVALID_REQUEST') {
  if (!schema.safeParse(value).success) throw new FileStoreError(code);
  return value;
}

function parseEntries(text) {
  let entries;
  try {
    entries = JSON.parse(text);
  } catch {
    throw new FileStoreError('INVALID_CONFIG');
  }
  return validate(diskSchema, entries, 'INVALID_CONFIG');
}

function identity(entry) {
  return { model: entry.model, base_url: entry.base_url, key: entry.key };
}

function expose(entry) {
  return { ...identity(entry), channel: entry.channel ?? '' };
}

export function createService(store) {
  return Object.freeze({
    async state() {
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

    async apply(body) {
      validate(applySchema, body);
      await store.update('zshrc', async (text, readDependency) => {
        const entries = parseEntries(await readDependency('config'));
        const index = findActiveIndex(entries, {
          model: body.expected.model,
          url: body.expected.base_url,
          key: body.expected.key,
        });
        if (index < 0) throw new FileStoreError('CONFLICT');
        const entry = entries[index];
        validate(writeIdentitySchema, identity(entry), 'INVALID_CONFIG');
        return insertZshrcBlock(text, entry);
      });
    },

    async change(method, index, body) {
      validate(changeSchemas[method], body);
      await store.update('config', text => {
        const entries = parseEntries(text);
        if (method !== 'POST'
            && !IDENTITY.every(key => entries[index]?.[key] === body.expected[key])) {
          throw new FileStoreError('CONFLICT');
        }
        const next = method === 'POST' ? [...entries, body.entry]
          : method === 'PATCH'
            ? entries.map((entry, position) => position === index ? body.entry : entry)
            : entries.filter((_, position) => position !== index);
        return `${JSON.stringify(next, null, 4)}\n`;
      });
    },
  });
}

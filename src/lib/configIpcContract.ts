import { z } from 'zod';
import { configStateSchema } from './configContract';

const identityFields = {
  model: z.string(),
  base_url: z.string(),
  key: z.string(),
};
const text = z.string().refine(value =>
  !/[\x00-\x1f\x7f-\x9f]/.test(value)
    && !/[\ud800-\udfff]/u.test(value));
const requiredText = text.refine(value => value.trim().length > 0);
const writeFields = {
  model: requiredText,
  base_url: requiredText,
  key: requiredText,
};
export const expectedSchema = z.strictObject(identityFields);
export const writeIdentitySchema = z.strictObject(writeFields);
const entrySchema = z.strictObject({ ...writeFields, channel: text });
export const applySchema = z.strictObject({ expected: expectedSchema });
export const changeSchemas = Object.freeze({
  POST: z.strictObject({ entry: entrySchema }),
  PATCH: z.strictObject({ expected: expectedSchema, entry: entrySchema }),
  DELETE: z.strictObject({ expected: expectedSchema }),
});

const indexSchema = z.number().int().nonnegative().safe();
export const configIpcRequestSchemas = Object.freeze({
  state: z.strictObject({}),
  apply: applySchema,
  add: changeSchemas.POST,
  edit: changeSchemas.PATCH.extend({ index: indexSchema }),
  remove: changeSchemas.DELETE.extend({ index: indexSchema }),
});

export const configIpcErrorCodeSchema = z.enum([
  'ROOT_FORBIDDEN',
  'INVALID_HOME',
  'UNKNOWN_KEY',
  'READ_ONLY',
  'UNSUPPORTED_PLATFORM',
  'UNSAFE_PATH',
  'UNSUPPORTED_FILE',
  'METADATA_UNSUPPORTED',
  'METADATA_CHECK_FAILED',
  'FILE_MISSING',
  'TOO_LARGE',
  'INVALID_UTF8',
  'CONFLICT',
  'INVALID_CONFIG',
  'INVALID_REQUEST',
  'FORBIDDEN',
  'BODY_TOO_LARGE',
  'RATE_LIMITED',
  'TRANSFORM_FAILED',
  'IO_FAILED',
  'WRITE_UNCERTAIN',
]);
const errorSchema = z.strictObject({
  success: z.literal(false),
  code: configIpcErrorCodeSchema,
  cleanupFailed: z.boolean(),
});
const stateResponseSchema = z.discriminatedUnion('success', [
  z.strictObject({ success: z.literal(true), data: configStateSchema }),
  errorSchema,
]);
const writeResponseSchema = z.discriminatedUnion('success', [
  z.strictObject({ success: z.literal(true) }),
  errorSchema,
]);
export const configIpcResponseSchemas = Object.freeze({
  state: stateResponseSchema,
  apply: writeResponseSchema,
  add: writeResponseSchema,
  edit: writeResponseSchema,
  remove: writeResponseSchema,
});

export type ConfigIpcMethod = keyof typeof configIpcRequestSchemas;
export type ConfigIpcRequest<M extends ConfigIpcMethod> =
  z.infer<(typeof configIpcRequestSchemas)[M]>;
export type ConfigIpcResponse<M extends ConfigIpcMethod> =
  z.infer<(typeof configIpcResponseSchemas)[M]>;
export type ConfigIpcErrorCode = z.infer<typeof configIpcErrorCodeSchema>;

export const configIpcChannels = Object.freeze({
  state: 'config:state',
  apply: 'config:apply',
  add: 'config:add',
  edit: 'config:edit',
  remove: 'config:remove',
} as const satisfies Record<ConfigIpcMethod, string>);

export type ConfigIpcChannel = (typeof configIpcChannels)[ConfigIpcMethod];
export type ConfigBridge = {
  readonly [M in ConfigIpcMethod]: (
    request: ConfigIpcRequest<M>
  ) => Promise<ConfigIpcResponse<M>>;
};

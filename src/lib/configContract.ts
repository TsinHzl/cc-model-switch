import { z } from 'zod';

const entrySchema = z.object({
  model: z.string(),
  base_url: z.string(),
  key: z.string(),
  channel: z.string(),
});
export const configStateSchema = z.object({
  entries: z.array(entrySchema),
  groups: z.array(z.object({
    url: z.string(),
    channels: z.array(z.object({
      channel: z.string(),
      items: z.array(z.object({
        entry: entrySchema,
        index: z.number().int().nonnegative().safe(),
      })),
    })),
  })),
  activeIndex: z.number().int().min(-1).safe(),
}).refine(state =>
  state.activeIndex < state.entries.length
  && state.groups.every(group => group.channels.every(channel =>
    channel.items.every(item => item.index < state.entries.length))));

export type ConfigState = z.infer<typeof configStateSchema>;

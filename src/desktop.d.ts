import type { ClipboardBridge } from './lib/clipboardIpcContract';
import type { ConfigBridge } from './lib/configIpcContract';

declare global {
  interface Window {
    readonly desktop?: {
      readonly platform: string;
      readonly config: ConfigBridge;
      readonly clipboard: ClipboardBridge;
    };
  }
}

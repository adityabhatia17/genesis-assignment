import { config } from '@vue/test-utils';

// Reka primitives portal into document.body; keep tests deterministic and quiet.
config.global.stubs = { teleport: true };

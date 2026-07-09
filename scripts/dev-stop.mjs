#!/usr/bin/env node
/** Stop local dev servers on the default Veylin ports. */
import { cleanDevPorts, DEV_PORTS } from './dev-utils.mjs';

cleanDevPorts();
console.log(`[dev] stopped listeners on port(s): ${DEV_PORTS.join(', ')}`);

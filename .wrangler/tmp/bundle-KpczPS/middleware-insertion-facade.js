				import worker, * as OTHER_EXPORTS from "/Users/Apple/Code/chelsea_bot/dist/worker.mjs";
				import * as __MIDDLEWARE_0__ from "/Users/Apple/Code/chelsea_bot/node_modules/.pnpm/wrangler@4.84.1/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts";
import * as __MIDDLEWARE_1__ from "/Users/Apple/Code/chelsea_bot/node_modules/.pnpm/wrangler@4.84.1/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts";

				export * from "/Users/Apple/Code/chelsea_bot/dist/worker.mjs";
				const MIDDLEWARE_TEST_INJECT = "__INJECT_FOR_TESTING_WRANGLER_MIDDLEWARE__";
				export const __INTERNAL_WRANGLER_MIDDLEWARE__ = [
					
					__MIDDLEWARE_0__.default,__MIDDLEWARE_1__.default
				]
				export default worker;
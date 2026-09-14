import { vi } from "vitest";

// `createMockRedis` and `RedisTestModule.forTest` from @nestjs-modules/ioredis
// are implemented with `jest.fn()`: the library assumes Jest, and under
// Vitest `jest` does not exist, so every spec that uses them dies with
// "jest is not defined" before even reaching an assertion.
//
// The alternative would be to replace that helper with a hand-written mock
// in every spec that uses it, duplicating the list of Redis methods that
// the library already maintains. This alias is one line and does not touch
// node_modules.
//
// To be removed when the library provides its own mocks in a
// runner-neutral way.
(globalThis as unknown as { jest: typeof vi }).jest = vi;

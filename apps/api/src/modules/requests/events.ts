import type { PubSub } from '../../lib/pubsub.js';
import type { RequestSummary } from './serializers.js';

/** Lo que pasa en un endpoint. Lo publica el API y lo escuchan el stream SSE (y luego el CLI). */
export type EndpointEvent = { type: 'request'; request: RequestSummary } | { type: 'cleared' };

/** Canal: el slug del endpoint. */
export type EndpointBus = PubSub<EndpointEvent>;

import type { AppConfig } from '../config';
import type { Storage } from './ports/storage';

/** What application services receive: configuration plus persistence. */
export interface AppContext {
  config: AppConfig;
  storage: Storage;
}

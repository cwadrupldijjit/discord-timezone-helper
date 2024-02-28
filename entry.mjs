import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { register as registerTs } from 'ts-node';

register('ts-node/esm', pathToFileURL('./'));
registerTs();

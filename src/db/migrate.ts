import { openDb } from './client';
await openDb();
console.log('migrations applied');

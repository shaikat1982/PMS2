import * as git from '@/server/api/git.js';
import { handle } from '@/server/http.js';

export const PATCH = handle(git.updateRepository);
export const DELETE = handle(git.disconnectRepository);

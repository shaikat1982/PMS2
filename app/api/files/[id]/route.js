import * as attachments from '@/server/api/attachments.js';
import { handle } from '@/server/http.js';

export const GET = handle(attachments.download, { auth: false });

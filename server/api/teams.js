import { all, get, insert, run, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { color, created, idList, idParam, notFound, setClause, text } from '../util.js';

async function listTeams() {
  const [teams, members] = await Promise.all([all('SELECT * FROM teams ORDER BY name'), all('SELECT team_id, user_id FROM team_members')]);
  return teams.map((t) => ({ ...t, member_ids: members.filter((m) => m.team_id === t.id).map((m) => m.user_id) }));
}

async function setMembers(teamId, userIds) {
  await run('DELETE FROM team_members WHERE team_id = ?', teamId);
  if (userIds.length) {
    await run(
      'INSERT INTO team_members (team_id, user_id) SELECT ?::int, id FROM users WHERE id = ANY(?::int[]) ON CONFLICT DO NOTHING',
      teamId, userIds,
    );
  }
}

export const list = () => listTeams();

export async function create({ user, body: b }) {
  requireRole(user, 'admin', 'manager');
  const memberIds = idList(b.member_ids, 'member_ids') || [];
  const id = await tx(async () => {
    const teamId = await insert(
      'INSERT INTO teams (name, description, color) VALUES (?, ?, ?)',
      text(b.name, 'Name', { required: true, max: 100 }), text(b.description, 'Description', { max: 1000 }), color(b.color) || '#7b68ee',
    );
    await setMembers(teamId, memberIds);
    return teamId;
  });
  return created((await listTeams()).find((t) => t.id === id));
}

export async function update({ user, params, body: b }) {
  requireRole(user, 'admin', 'manager');
  const id = idParam(params.id);
  if (!await get('SELECT id FROM teams WHERE id = ?', id)) throw notFound('Team');
  const memberIds = idList(b.member_ids, 'member_ids');
  await tx(async () => {
    const { sql, values, keys } = setClause({
      name: text(b.name, 'Name', { required: b.name !== undefined, max: 100 }),
      description: text(b.description, 'Description', { max: 1000 }),
      color: color(b.color),
    });
    if (keys.length) await run(`UPDATE teams SET ${sql} WHERE id = ?`, ...values, id);
    if (memberIds) await setMembers(id, memberIds);
  });
  return (await listTeams()).find((t) => t.id === id);
}

export async function remove({ user, params }) {
  requireRole(user, 'admin', 'manager');
  const { changes } = await run('DELETE FROM teams WHERE id = ?', idParam(params.id));
  if (!changes) throw notFound('Team');
}

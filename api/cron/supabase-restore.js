const SUPABASE_PROJECTS_URL = 'https://api.supabase.com/v1/projects';
const REQUEST_TIMEOUT_MS = 8_000;

const PROJECT_STATUSES = new Set([
  'INACTIVE',
  'ACTIVE_HEALTHY',
  'ACTIVE_UNHEALTHY',
  'COMING_UP',
  'UNKNOWN',
  'GOING_DOWN',
  'INIT_FAILED',
  'REMOVED',
  'RESTORING',
  'UPGRADING',
  'PAUSING',
  'RESTORE_FAILED',
  'RESTARTING',
  'PAUSE_FAILED',
  'RESIZING',
]);

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createHandler({ env = process.env, fetchImpl } = {}) {
  return async function supabaseRestore(request, response) {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return response.status(405).json({ error: 'method_not_allowed' });
    }

    const cronSecret = env.CRON_SECRET;
    if (!hasValue(cronSecret)) {
      return response.status(503).json({ error: 'service_unavailable' });
    }

    if (request.headers?.authorization !== `Bearer ${cronSecret}`) {
      return response.status(401).json({ error: 'unauthorized' });
    }

    const accessToken = env.SUPABASE_ACCESS_TOKEN;
    const projectRef = env.SUPABASE_PROJECT_REF;
    if (
      !hasValue(accessToken) ||
      !hasValue(projectRef) ||
      !/^[a-z0-9]+$/.test(projectRef)
    ) {
      return response.status(503).json({ error: 'service_unavailable' });
    }

    const fetchRequest = fetchImpl || globalThis.fetch;
    if (typeof fetchRequest !== 'function') {
      return response.status(503).json({ error: 'service_unavailable' });
    }

    const projectUrl = `${SUPABASE_PROJECTS_URL}/${encodeURIComponent(projectRef)}`;
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    };

    try {
      const projectResponse = await fetchRequest(projectUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      });

      if (!projectResponse.ok) {
        return response.status(502).json({ error: 'supabase_unavailable' });
      }

      const project = await projectResponse.json();
      const status = PROJECT_STATUSES.has(project?.status) ? project.status : 'UNKNOWN';
      if (project?.status !== 'INACTIVE') {
        return response.status(200).json({ ok: true, action: 'none', status });
      }

      const restoreResponse = await fetchRequest(`${projectUrl}/restore`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      });

      if (!restoreResponse.ok) {
        return response.status(502).json({ error: 'supabase_unavailable' });
      }

      return response.status(200).json({
        ok: true,
        action: 'restore_requested',
        status: 'INACTIVE',
      });
    } catch {
      return response.status(502).json({ error: 'supabase_unavailable' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;

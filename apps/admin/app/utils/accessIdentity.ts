import { type AccessIdentity, extractAccessToken, verifyAccessJwt } from "./verifyAccessJwt";

export type AccessEnv = { CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string };

// The Access check every ticket route runs before it reads or writes buyer
// data: config present, token present, token verified. Fails closed on each,
// with no dev-mode bypass, same as routes/api/send-push.ts.
export async function identifyAccessRequest(
  request: Request,
  env: AccessEnv | undefined,
): Promise<AccessIdentity | null> {
  const teamDomain = env?.CF_ACCESS_TEAM_DOMAIN;
  const aud = env?.CF_ACCESS_AUD;
  if (!teamDomain || !aud) return null;
  const token = extractAccessToken(request);
  if (!token) return null;
  return verifyAccessJwt(token, { teamDomain, aud });
}

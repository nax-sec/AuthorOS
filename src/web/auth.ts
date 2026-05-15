export function isAuthorized(request: Request, token?: string): boolean {
  if (!token) return true;
  const authorization = request.headers.get('authorization') ?? '';
  if (authorization === `Bearer ${token}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get('token') === token;
}


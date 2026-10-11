export class UpstreamError extends Error {
  constructor(public service: string, public status?: number, detail?: string) {
    super(`${service} request failed${status ? ` (${status})` : ''}${detail ? `: ${detail}` : ''}`);
    this.name = 'UpstreamError';
  }
}

export class TokenNotFoundError extends Error {
  constructor(public address: string) {
    super(`No trading pairs found for ${address}`);
    this.name = 'TokenNotFoundError';
  }
}

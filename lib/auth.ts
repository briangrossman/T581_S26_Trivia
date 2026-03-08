import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

const COOKIE_NAME = 'teacher_token';
const COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return new TextEncoder().encode(secret);
}

export interface TeacherPayload {
  teacherId: number;
  username: string;
}

export async function signTeacherToken(payload: TeacherPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('8h')
    .sign(getSecret());
}

export async function verifyTeacherToken(token: string): Promise<TeacherPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      teacherId: payload.teacherId as number,
      username: payload.username as string,
    };
  } catch {
    return null;
  }
}

// For use in Server Components and API Route Handlers
export async function getTeacherFromCookies(): Promise<TeacherPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyTeacherToken(token);
}

// For use in middleware (edge runtime) — reads from request directly
export async function getTeacherFromRequest(request: NextRequest): Promise<TeacherPayload | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyTeacherToken(token);
}

export function buildSetCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function buildClearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

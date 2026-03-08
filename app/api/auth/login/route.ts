import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { signTeacherToken, buildSetCookieHeader } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
    }

    const result = await sql<{ id: number; username: string; password_hash: string }>`
      SELECT id, username, password_hash FROM teachers WHERE username = ${username} LIMIT 1
    `;

    const teacher = result.rows[0];
    if (!teacher) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, teacher.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const token = await signTeacherToken({ teacherId: teacher.id, username: teacher.username });
    const response = NextResponse.json({ ok: true });
    response.headers.set('Set-Cookie', buildSetCookieHeader(token));
    return response;
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getTeacherFromRequest } from '@/lib/auth';

export async function middleware(request: NextRequest) {
  const teacher = await getTeacherFromRequest(request);
  if (!teacher) {
    return NextResponse.redirect(new URL('/teacher/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/teacher/dashboard/:path*', '/teacher/game/:path*'],
};

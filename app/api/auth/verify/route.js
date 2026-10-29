import { AuthService } from '@/lib/auth/auth.js';

export async function POST(request) {
  try {
    const { token } = await request.json();
    
    const authService = new AuthService();
    
    const user = await authService.verifySession(token);
    
    if (!user) {
      return Response.json(
        { valid: false, error: 'Invalid or expired session' },
        { status: 401 }
      );
    }
    
    return Response.json({
      valid: true,
      user
    });
    
  } catch (error) {
    console.error('Verify error:', error);
    return Response.json(
      { valid: false, error: 'Verification failed' },
      { status: 500 }
    );
  }
}

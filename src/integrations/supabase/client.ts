const emptySession = { session: null };

function buildAuthError(message: string) {
  return { error: new Error(message) };
}

export const supabase = {
  auth: {
    onAuthStateChange(callback?: () => void) {
      void callback;
      return {
        data: {
          subscription: {
            unsubscribe() {
              return undefined;
            },
          },
        },
      };
    },
    async getSession() {
      return { data: emptySession, error: null };
    },
    async signInWithPassword() {
      return buildAuthError("Autenticacao remota desativada na VPS.");
    },
    async signOut() {
      return { error: null };
    },
  },
};

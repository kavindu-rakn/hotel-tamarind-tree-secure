import 'next-auth/jwt'

declare module 'next-auth/jwt' {
  interface JWT {
    id?:   string
    role?: string
    signedInAt?: number
  }
}

import { Lock, Mail, Gamepad2 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 md:p-8 bg-background relative overflow-hidden">
      {/* Optional: Add a subtle patterned background or gradient here if you want it to look more like the original html's body background */}
      <main className="flex flex-col md:flex-row w-full max-w-6xl bg-card rounded-xl overflow-hidden shadow-xl border relative z-10">
        {/* Left Side: Decorative Element */}
        <div className="hidden md:flex md:w-1/2 relative bg-primary/10 overflow-hidden items-center justify-center p-12">
          {/* Decorative floating blobs in background */}
          <div className="absolute top-[-10%] left-[-10%] w-64 h-64 bg-primary/20 rounded-full blur-3xl"></div>
          <div className="absolute bottom-[-5%] right-[-5%] w-80 h-80 bg-blue-500/20 rounded-full blur-3xl opacity-50"></div>
          
          <div className="relative z-10 w-full h-full flex flex-col justify-center">
            {/* Using arbitrary placeholder since the external image was used */}
            <div className="w-full flex-1 min-h-[300px] relative transition-transform duration-500 hover:scale-105 flex items-center justify-center">
               <img
                  alt="Playful App Illustration"
                  className="w-full h-full object-contain drop-shadow-2xl"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuAV9gXnByPdCIF1YEyDVfeX-wxKhspEaMjuuUxAUXWmGK6MDtUhHOHr9Mnt8gwBtOA5CZlh4MidbvAKhPTdIaZDXUQtKLVUOMhc1mlHb6xvcgisEzyThUBYZz7E7L4gw1pxVpFk7houE8Aceg5IwSHDE6D6Qwjx25Qv4BKWuSqgbtqP-z23xACOh1YINFXp7n0bcBj4mDAC6yEve76ac3ZaYs3f60IcNsSMA17aPycMV6Io59Wi9qcKvN-mB0ZnaLAm3EXmkAsJrmbz"
                />
            </div>
            
            <div className="mt-8 text-center">
              <h1 className="text-4xl font-black text-foreground tracking-tight">Unlock the Fun</h1>
              <p className="text-muted-foreground mt-2 text-lg font-medium">Join thousands of friends in the ultimate playground.</p>
            </div>
          </div>
        </div>

        {/* Right Side: Form Container */}
        <div className="w-full md:w-1/2 bg-background flex items-center justify-center p-8 md:p-16">
          <div className="w-full max-w-md">
            {/* Logo/Header */}
            <div className="flex items-center gap-2 mb-10">
              <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/20">
                <Gamepad2 className="text-primary-foreground focus:outline-none" size={24} />
              </div>
              <span className="text-2xl font-black text-primary tracking-tighter">Playroom</span>
            </div>

            <div className="mb-10">
              <h2 className="text-3xl font-extrabold text-foreground mb-2">Welcome Back!</h2>
              <p className="text-muted-foreground font-medium">Please enter your details to sign in.</p>
            </div>

            <form className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-bold ml-1">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
                  <Input 
                    id="email" 
                    type="email" 
                    placeholder="name@example.com" 
                    className="pl-11 py-6 bg-muted/50 border-transparent rounded-lg font-medium focus-visible:ring-primary/40 focus-visible:border-primary/40 transition-all text-base"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <Label htmlFor="password" className="text-sm font-bold">Password</Label>
                  <Link href="#" className="text-sm font-bold text-primary hover:text-primary/80 transition-colors">
                    Forgot Password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
                  <Input 
                    id="password" 
                    type="password" 
                    placeholder="••••••••" 
                    className="pl-11 py-6 bg-muted/50 border-transparent rounded-lg font-medium focus-visible:ring-primary/40 focus-visible:border-primary/40 transition-all text-base"
                  />
                </div>
              </div>

              <Button type="submit" className="w-full py-6 text-lg font-bold rounded-full shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all duration-200">
                Sign In
              </Button>
            </form>

            <div className="relative my-10">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-background text-muted-foreground font-bold">Or continue with</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Button variant="outline" className="py-6 rounded-lg font-bold hover:bg-muted/50 transition-all">
                <img alt="Google" className="w-5 h-5 mr-2" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA3viruLjnhn9Qgtn5ymfNaJ1xC9KG84w6hxBpAf5XBUKSZ1DaW6RQRNGSyV_sSCbL4MolHMM-HauunmVeBYan1GYr7BjUku2-NSfqJfDeHzLDDuCGjz_1JFmQp4cRsVElZu5ix2OStnvz8dUVIQHtTIWI0s6bFYn26b6sYWwUjj6X4SWtPVzFG4aNjAPydUZZ5_Gf4LyXSFe0sz5ATIAgqDZ_zUm9xissGR0AmdMieiBwMW_Ni7s347Wj-l8lGEY8rcEkyIDVlIU6i"/>
                Google
              </Button>
              <Button variant="outline" className="py-6 rounded-lg font-bold hover:bg-muted/50 transition-all">
                <svg className="w-5 h-5 mr-2 text-[#1877F2]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"></path>
                </svg>
                Facebook
              </Button>
            </div>

            <div className="mt-12 text-center">
              <p className="text-muted-foreground font-medium">
                Don't have an account?{" "}
                <Link href="#" className="text-primary font-bold hover:underline decoration-2 underline-offset-4 transition-all">
                  Sign Up
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer Navigation */}
      <footer className="absolute bottom-0 left-0 w-full p-6 flex flex-col md:flex-row justify-between items-center text-muted-foreground text-sm font-medium opacity-60">
        <div className="mb-2 md:mb-0">© 2024 Playroom. All rights reserved.</div>
        <div className="flex gap-6 z-20 relative">
          <Link href="#" className="hover:text-primary transition-colors">Privacy</Link>
          <Link href="#" className="hover:text-primary transition-colors">Terms</Link>
          <Link href="#" className="hover:text-primary transition-colors">Support</Link>
        </div>
      </footer>
    </div>
  );
}

"use client";

import { Lock, Mail, Gamepad2, User } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

import Image from "next/image";
import landingIlu from "@/assets/landing.png";
import cowImg from "@/assets/cow.png";
import sheepImg from "@/assets/sheep.png";
import sheep2Img from "@/assets/sheep2.png";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [isSheepSmiling, setIsSheepSmiling] = useState(false);
  const [cowSpinCount, setCowSpinCount] = useState(0);
  const [landingBounce, setLandingBounce] = useState(false);
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLandingClick = () => {
    setLandingBounce(true);
    setTimeout(() => setLandingBounce(false), 600);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");
    setLoading(true);

    try {
      if (!isLogin) {
        // Register User
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });
        
        const data = await res.json();
        
        if (!res.ok) {
          throw new Error(data.error || "Failed to register");
        }
        
        // Show success message and switch to login view
        setSuccessMsg("Successfully registered");
        setIsLogin(true);
        // Clear inputs after successful registration
        setPassword("");
        setName("");
      } else {
        // Login User
        const res = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });

        if (res?.error) {
          // NextAuth often returns "Configuration" or generic errors for credentials mismatch
          throw new Error("Wrong credentials");
        }

        router.push("/dashboard");
      }
    } catch (error: any) {
      setErrorMsg(error.message || "Wrong credentials");
    } finally {
      setLoading(false);
    }
  };

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
            {/* Content Container */}
            <div className="w-full flex flex-col items-center justify-center p-4">
              
              {/* Main Illustration Area with Overlaps */}
              <div className="relative w-full max-w-[340px] mb-8">
                
                {/* Main Illustration */}
                <div 
                  className="w-full h-auto drop-shadow-2xl relative z-10 cursor-pointer"
                  onClick={handleLandingClick}
                  style={{
                    animation: landingBounce ? 'landingBounce 0.6s ease' : 'none',
                    transition: 'transform 0.5s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  title="Click me!"
                >
                  <Image
                      alt="MooBoard Illustration"
                      className="w-full h-auto object-contain"
                      src={landingIlu}
                      priority
                    />
                </div>

                {/* Interactive Overlapping Cow */}
                <div 
                  className="absolute -bottom-10 -left-6 w-[120px] h-[120px] z-20 hover:scale-110 active:scale-95 transition-all duration-500 cursor-pointer"
                  onClick={() => setCowSpinCount(prev => prev + 1)}
                  style={{ transform: `rotate(${cowSpinCount * 360}deg)` }}
                  title="Spin me!"
                >
                  <Image 
                    src={cowImg} 
                    alt="Cow Mascot" 
                    className="w-full h-full object-contain drop-shadow-2xl select-none transition-transform duration-500 hover:scale-110" 
                    priority
                  />
                </div>

                {/* Interactive Overlapping Sheep */}
                <div 
                  className="absolute -bottom-4 -right-4 w-[90px] h-[90px] z-20 hover:scale-110 active:scale-95 transition-transform duration-300 cursor-pointer"
                  onClick={() => setIsSheepSmiling(!isSheepSmiling)}
                  title="Click me!"
                >
                  <Image 
                    src={isSheepSmiling ? sheep2Img : sheepImg} 
                    alt="Sheep Mascot" 
                    className="w-full h-full object-contain drop-shadow-xl select-none" 
                    priority
                  />
                </div>

              </div>
            </div>
            
            {/* <div className="mt-12 text-center relative z-30">
              <h1 className="text-4xl font-black text-foreground tracking-tight">New for Reporting</h1>
              <p className="text-muted-foreground mt-2 text-lg font-medium">Our centralized dashboard for operational insights.</p>
            </div> */}
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
              <span className="text-2xl font-black text-primary tracking-tighter">MooBoard</span>
            </div>

            <div className="mb-10 transition-all duration-300">
              <h2 className="text-3xl font-extrabold text-foreground mb-2">
                {isLogin ? "Hii" : "Create an Account"}
              </h2>
              <p className="text-muted-foreground font-medium">
                {isLogin ? "Login first" : "Please fill in your details to get started."}
              </p>
            </div>

            {errorMsg && (
              <div className="mb-6 p-4 bg-destructive/15 text-destructive rounded-lg text-sm font-bold animate-in fade-in slide-in-from-top-2">
                {errorMsg}
              </div>
            )}
            
            {successMsg && (
              <div className="mb-6 p-4 bg-green-500/15 text-green-600 rounded-lg text-sm font-bold animate-in fade-in slide-in-from-top-2">
                {successMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {!isLogin && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                  <Label htmlFor="name" className="text-sm font-bold ml-1">Name</Label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
                    <Input 
                      id="name" 
                      type="text" 
                      placeholder="John Doe" 
                      required={!isLogin}
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setErrorMsg("");
                      }}
                      className="pl-11 py-6 bg-muted/50 border-transparent rounded-lg font-medium focus-visible:ring-primary/40 focus-visible:border-primary/40 transition-all text-base"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-bold ml-1">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
                  <Input 
                    id="email" 
                    type="email" 
                    placeholder="name@example.com" 
                    required
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setErrorMsg("");
                    }}
                    className="pl-11 py-6 bg-muted/50 border-transparent rounded-lg font-medium focus-visible:ring-primary/40 focus-visible:border-primary/40 transition-all text-base"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <Label htmlFor="password" className="text-sm font-bold">Password</Label>
                  {isLogin && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link href="#" className="text-sm font-bold text-primary hover:text-primary/80 transition-colors">
                          Forgot Password?
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>This feature is not available yet</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
                  <Input 
                    id="password" 
                    type="password" 
                    placeholder="••••••••" 
                    required
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setErrorMsg("");
                    }}
                    className="pl-11 py-6 bg-muted/50 border-transparent rounded-lg font-medium focus-visible:ring-primary/40 focus-visible:border-primary/40 transition-all text-base"
                  />
                </div>
              </div>

              <Button disabled={loading} type="submit" className="w-full py-6 text-lg font-bold rounded-full shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all duration-200">
                {loading ? "Please wait..." : isLogin ? "Sign In" : "Sign Up"}
              </Button>
            </form>

            <div className="mt-10 text-center">
              <p className="text-muted-foreground font-medium">
                {isLogin ? "Don't have an account? " : "Already have an account? "}
                <button 
                  type="button"
                  onClick={() => {
                    setIsLogin(!isLogin);
                    setErrorMsg("");
                    setSuccessMsg("");
                  }}
                  className="text-primary font-bold hover:underline decoration-2 underline-offset-4 transition-all"
                >
                  {isLogin ? "Sign Up" : "Sign In"}
                </button>
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer Navigation */}
      <footer className="absolute bottom-0 left-0 w-full p-6 flex flex-col md:flex-row justify-between items-center text-muted-foreground text-sm font-medium opacity-60">
        <div className="mb-2 md:mb-0">© Cow Play Cow Moo Indonesia. All rights reserved.</div>
        <div className="flex gap-6 z-20 relative">
          <Link href="#" className="hover:text-primary transition-colors">Privacy</Link>
          <Link href="#" className="hover:text-primary transition-colors">Terms</Link>
          <Link href="#" className="hover:text-primary transition-colors">Support</Link>
        </div>
      </footer>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../components/supabaseClient";
import { FiEye, FiEyeOff, FiMail, FiPhone, FiLock, FiUser, FiGift } from "react-icons/fi";

import { useToast } from "../components/Toast/ToastContext";
import logo from "../components/logo1.png";
import bgImage from "../components/Background-Image.png";
import "./Login.css";

function Login() {
  const [authMode, setAuthMode] = useState("login"); // 'login' or 'signup'
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.state) {
      const { email, phone, fullName, isNewUserCampaign } = location.state;
      if (email) setEmail(email);
      if (phone) {
        const clean = phone.replace(/^\+91/, "").replace(/\D/g, "");
        setPhone(clean);
      }
      if (fullName) setFullName(fullName);
      if (isNewUserCampaign) {
        setAuthMode("signup");
      }
    }
  }, [location.state]);

  const isValidPassword = (p) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(p);

  /* ================= CHECK SESSION ================= */
  useEffect(() => {
    const checkUser = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session?.user) return;

        const user = session.user;

        const { data: profile, error: profileError } = await supabase
          .from("profile")
          .select("full_name, phone")
          .eq("id", user.id)
          .maybeSingle();

        if (profileError) throw profileError;

        const profileName = profile?.full_name?.trim();
        const profilePhone = profile?.phone;

        if (!profileName || !profilePhone) {
          navigate("/complete-profile", { replace: true });
          return;
        }

        navigate("/services", { replace: true });
      } catch (error) {
        console.error("Session check error:", error);
        if (error.message?.includes("JWT") || error.message?.includes("sub claim")) {
          await supabase.auth.signOut();
          Object.keys(localStorage).forEach(key => {
            if (key.includes("supabase.auth.token") || key.startsWith("sb-")) {
              localStorage.removeItem(key);
            }
          });
        }
      }
    };

    checkUser();
  }, [navigate]);

  /* ================= AUTH ACTIONS ================= */
  const handleAuth = async () => {
    if (authMode === "signup") {
      await handleSignup();
    } else {
      await handleLogin();
    }
  };

  const handleSignup = async () => {
    if (!fullName || !email || !password || !phone) {
      toast.warning("Please fill all fields");
      return;
    }

    if (!isValidPassword(password)) {
      toast.error("Password must contain at least 8 characters, uppercase, lowercase, number, and special character.");
      return;
    }


    setLoading(true);
    try {
      const { data: { user: authUser }, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone_number: phone,
          },
        },
      });

      if (authError) throw authError;

      if (authUser) {
        const formattedPhone = phone.startsWith("+") ? phone : `+91${phone}`;
        
        // Validate Referral Code if provided
        let referrerId = null;
        if (referralCode.trim()) {
          const { data: refData } = await supabase
            .from("profile")
            .select("id")
            .eq("referral_code", referralCode.trim().toUpperCase())
            .maybeSingle();
          
          if (refData) {
            referrerId = refData.id;
          } else {
            toast.warning("Invalid referral code. Continuing without it.");
          }
        }

        const myReferralCode = "NEAT-" + fullName.substring(0,3).toUpperCase() + Math.random().toString(36).substring(2,6).toUpperCase();

        const { error: profileError } = await supabase.from("profile").upsert({
          id: authUser.id,
          full_name: fullName,
          email: authUser.email,
          phone: formattedPhone,
          referral_code: myReferralCode,
          referred_by_id: referrerId
        });

        if (profileError) console.error("Profile creation error:", profileError);

        // Also add to signup table
        await supabase.from("signup").upsert({
          id: authUser.id,
          full_name: fullName,
          email: authUser.email,
          phone: formattedPhone,
        });

        const cleanPhone = phone.replace(/\D/g, "").slice(-10);

        const promises = [
          supabase.from("wallet").upsert({ user_id: authUser.id, balance: 0 })
        ];

        if (referrerId) {
          const welcomeCouponCode = `WELCOME50_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

          promises.push(
            supabase.from("referrals").insert({
              referrer_id: referrerId,
              referred_user_id: authUser.id,
              status: 'pending'
            })
          );
          
          promises.push(
            supabase.from("coupons").insert({
              coupon_code: welcomeCouponCode,
              discount_amount: 50,
              is_used: false,
              phone_number: cleanPhone,
              is_active: true
            })
          );
        }

        await Promise.all(promises);

        if (profileError) throw profileError;
      }

      toast.success("Signup successful!");
      navigate("/services");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!email || !password) {
      toast.warning("Please enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      const { data: { user }, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      const { data: profile } = await supabase
        .from("profile")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();

      const profileName = profile?.full_name?.trim();

      if (!profileName) {
        navigate("/complete-profile");
      } else {
        navigate("/services");
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };



  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/auth/callback",
      },
    });

    if (error) toast.error(error.message);
  };


  return (
    <div className="auth-page" style={{ backgroundImage: `url(${bgImage})` }}>
      <div className="auth-container animate-fadeIn">
        
        {/* Left Side: Branding & Logo */}
        <div className="auth-visual-side">
          <div className="brand-content">
            <div className="brand-header">
              <div className="spray-container">
                <img src={logo} alt="Neatify Logo" className="auth-logo-large animate-spray" />
              </div>
              <div className="brand-title-group">
                <h1 className="auth-brand-large animate-slideInRight" style={{ "--order": 1 }}>The Neatify Team™</h1>
                <p className="auth-subtitle-large animate-slideInRight" style={{ "--order": 2 }}>We Neatify Your Space</p>
              </div>
            </div>
          </div>


          
          {/* Decorative elements for the visual side */}
          <div className="visual-decoration-1"></div>
          <div className="visual-decoration-2"></div>
        </div>

        {/* Right Side: Authentication Form */}
        <div className="auth-form-side">
          <div className="auth-card-new animate-fadeInRight">
            <div className="mobile-header">
               <img src={logo} alt="Neatify Logo" className="auth-logo-small" />
               <h2 className="auth-brand-small">The Neatify Team™</h2>
            </div>

            <h2 className="form-title">{authMode === "login" ? "Welcome Back" : "Join the Team"}</h2>
            <p className="form-subtitle">{authMode === "login" ? "Login to manage your bookings." : "Create an account to get started."}</p>

            {authMode === "signup" && (
              <div className="input-wrapper animate-fadeInUp" style={{ "--order": 1 }}>
                <FiUser className="auth-input-icon" />
                <input
                  type="text"
                  placeholder="Full Name"
                  className="auth-input with-icon"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
            )}

            <div className="input-wrapper animate-fadeInUp" style={{ "--order": 2 }}>
              <FiMail className="auth-input-icon" />
              <input
                type="email"
                placeholder="Email"
                className="auth-input with-icon"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="input-wrapper animate-fadeInUp" style={{ "--order": 3 }}>
              <FiLock className="auth-input-icon" />
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                className="auth-input with-icon"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="eye-button"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <FiEye /> : <FiEyeOff />}
              </button>
            </div>

            {/* PASSWORD POLICY (SIGNUP ONLY) */}
            {authMode === "signup" && password.length > 0 && (
              <div className="policy-container animate-fadeIn">
                <PolicyRow label="At least 8 characters in length" isMet={password.length >= 8} />
                <PolicyRow label="Lowercase letters (a-z)" isMet={/[a-z]/.test(password)} />
                <PolicyRow label="Uppercase letters (A-Z)" isMet={/[A-Z]/.test(password)} />
                <PolicyRow label="Numbers (0-9)" isMet={/\d/.test(password)} />
                <PolicyRow label="Special characters (@$!%*?&)" isMet={/[@$!%*?&]/.test(password)} />
              </div>
            )}



            {authMode === "signup" && (
              <>
                <div className="input-wrapper animate-fadeInUp" style={{ "--order": 4 }}>
                  <FiPhone className="auth-input-icon" />
                  <input
                    type="tel"
                    placeholder="+91 Phone Number"
                    className="auth-input with-icon"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  />
                </div>
                <div className="input-wrapper animate-fadeInUp" style={{ "--order": 5 }}>
                  <FiGift className="auth-input-icon" />
                  <input
                    type="text"
                    placeholder="Referral/Discount Code (Optional)"
                    className="auth-input with-icon"
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  />
                </div>
              </>
            )}

            <div className="animate-fadeInUp" style={{ "--order": 6 }}>
              <button className="auth-button" onClick={handleAuth} disabled={loading}>
                {loading ? "..." : authMode === "login" ? "Login" : "Create Account"}
              </button>
            </div>

            {authMode === "login" && (
              <p
                className="auth-link-text animate-fadeInUp"
                onClick={() => navigate("/forgot-password")}
                style={{ 
                  cursor: "pointer", 
                  marginTop: "15px", 
                  color: "#f4c430", 
                  fontWeight: "600",
                  "--order": 7 
                }}
              >
                Forgot Password
              </p>
            )}

            <div className="auth-divider animate-fadeInUp" style={{ "--order": 8 }}>OR</div>

            <div className="animate-fadeInUp" style={{ "--order": 9 }}>
              <button className="auth-button google-button" onClick={handleGoogleLogin}>
                <img
                  src="https://cdn-icons-png.flaticon.com/512/2991/2991148.png"
                  alt="Google"
                  className="google-icon"
                />
                Continue with Google
              </button>
            </div>

            <p className="auth-toggle-text animate-fadeInUp" style={{ "--order": 10 }}>
              {authMode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
              <span
                onClick={() => {
                  setAuthMode(authMode === "login" ? "signup" : "login");
                  setPassword(""); // Clear password when toggling
                }}
                className="auth-toggle-link"
              >
                {authMode === "login" ? "Sign Up" : "Login"}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );

}

function PolicyRow({ label, isMet }) {
  return (
    <div className={`policy-row ${isMet ? 'policy-met' : 'policy-unmet'}`}>
      <span className="policy-icon">{isMet ? "✓" : "✕"}</span>
      <span>{label}</span>
    </div>
  );
}


export default Login;

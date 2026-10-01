import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../components/supabaseClient";
import { FiUser, FiMail, FiPhone, FiLock, FiEye, FiEyeOff, FiChevronLeft, FiMapPin } from "react-icons/fi";
import { useToast } from "../components/Toast/ToastContext";
import Header from "../components/Header";
import bgImage from "../components/Background-Image.png";

function Signup({ user }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [pincode, setPincode] = useState("");
  const [referralCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    // We NO LONGER clear claimedOffer on mount, so if a user clicked a promo banner
    // and was redirected here, their banner offer is preserved.
  }, []);

  const handleSignup = async (e) => {
    if (e) e.preventDefault();

    if (!fullName.trim() || !email.trim() || !password || !phone.trim() || !pincode.trim()) {
      toast.warning("Please fill all required fields.");
      return;
    }

    if (password.length < 6) {
      toast.warning("Password must be at least 6 characters.");
      return;
    }

    const cleanDigits = phone.replace(/\D/g, "");
    if (cleanDigits.length !== 10) {
      toast.warning("Please enter a valid 10-digit mobile number.");
      return;
    }

    const formattedPhone = phone.startsWith("+") ? phone : `+91${cleanDigits}`;
    setLoading(true);

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: fullName,
            full_name: fullName,
            phone_number: formattedPhone,
          },
        },
      });

      if (authError) {
        toast.error(authError.message);
        setLoading(false);
        return;
      }

      const newUser = authData?.user;

      if (!newUser) {
        toast.success("Account created! Please log in.");
        navigate("/login");
        setLoading(false);
        return;
      }

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

      const { error: signupError } = await supabase.from("profile").upsert({
        id: newUser.id,
        full_name: fullName,
        email: newUser.email,
        phone: formattedPhone,
        pincode,
        referral_code: "NEAT-" + fullName.substring(0, 3).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase(),
        referred_by_id: referrerId
      });

      if (signupError) {
        toast.error("Profile creation failed: " + signupError.message);
        setLoading(false);
        return;
      }

      // Initialize Wallet & Tracking sequentially to prevent silent failures
      const welcomeCouponCode = `WELCOME50_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const cleanPhone = formattedPhone.replace(/\D/g, "").slice(-10);

      const { error: walletError } = await supabase.from("wallet").upsert({ user_id: newUser.id, balance: 0 });
      if (walletError) console.error("Wallet Error:", walletError);

      if (referrerId) {
        const { error: refError } = await supabase.from("referrals").insert({
          referrer_id: referrerId,
          referred_user_id: newUser.id,
          status: 'pending',
          reward_amount: 50
        });
        if (refError && refError.code !== '23505') {
          console.error("Referral Error:", refError);
        }

        const { error: couponError } = await supabase.from("coupons").insert({
          coupon_code: welcomeCouponCode,
          discount_amount: 50,
          is_used: false,
          phone_number: cleanPhone,
          is_active: true
        }).select();

        if (couponError) {
          console.error("COUPON INSERT ERROR:", couponError);
        }
      }

      if (sessionStorage.getItem("claimedOffer")) {
        toast.success("Account created! Your promotional offer is ready.");
      } else {
        toast.success("Account created successfully! Welcome to Neatify.");
      }
      navigate("/services");
    } catch (err) {
      toast.error(err.message || "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signup-page-wrapper">
      <Header user={user} />

      <div className="signup-content-container">
        <div className="signup-card">
          <button
            type="button"
            className="signup-back-btn"
            onClick={() => navigate(-1)}
            aria-label="Go back"
          >
            <FiChevronLeft />
          </button>

          <div className="signup-badge">✨</div>
          <h2 className="signup-title">New User Registration</h2>
          <p className="signup-subtitle">Please enter the details below to register.</p>

          <form onSubmit={handleSignup}>
            {/* FULL NAME */}
            <div className="signup-field">
              <label className="signup-label">FULL NAME</label>
              <div className="signup-input-row">
                <FiUser className="signup-icon" />
                <input
                  type="text"
                  className="signup-input"
                  placeholder="Enter full name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>

            {/* PHONE NUMBER */}
            <div className="signup-field">
              <label className="signup-label">PHONE NUMBER</label>
              <div className="signup-input-row">
                <FiPhone className="signup-icon" />
                <span className="signup-phone-prefix">+91</span>
                <input
                  type="tel"
                  className="signup-input"
                  placeholder="10-digit mobile number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  disabled={loading}
                />
              </div>
            </div>

            {/* EMAIL ADDRESS */}
            <div className="signup-field">
              <label className="signup-label">EMAIL ADDRESS</label>
              <div className="signup-input-row">
                <FiMail className="signup-icon" />
                <input
                  type="email"
                  className="signup-input"
                  placeholder="Enter email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>

            {/* CREATE PASSWORD */}
            <div className="signup-field">
              <label className="signup-label">CREATE PASSWORD</label>
              <div className="signup-input-row">
                <FiLock className="signup-icon" />
                <input
                  type={showPassword ? "text" : "password"}
                  className="signup-input"
                  placeholder="Create password (min 6 characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="signup-eye-btn"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <FiEye /> : <FiEyeOff />}
                </button>
              </div>
            </div>

            {/* LOCATION */}
            <div className="signup-field">
              <label className="signup-label">LOCATION</label>
              <div className="signup-input-row">
                <FiMapPin className="signup-icon" />
                <input
                  type="text"
                  className="signup-input"
                  placeholder="City or region"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>

            <button type="submit" className="signup-submit-btn" disabled={loading}>
              {loading ? "Registering..." : "Register User →"}
            </button>
          </form>
        </div>
      </div>


      <style>{`
        .signup-page-wrapper {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background-image: url(${bgImage});
          background-size: cover;
          background-position: center;
          background-attachment: fixed;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        .signup-content-container {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
        }

        .signup-card {
          width: 100%;
          max-width: 436px;
          background: #ffffff;
          border-radius: 24px;
          padding: 40px 36px 36px;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.12);
          position: relative;
          text-align: left;
        }

        .signup-back-btn {
          position: absolute;
          top: 24px;
          left: 24px;
          width: 40px;
          height: 40px;
          border-radius: 12px;
          background: #fafafa;
          border: 1.5px solid #e5e7eb;
          color: #4b5563;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          cursor: pointer;
          transition: all 0.2s ease;
          z-index: 10;
        }

        .signup-back-btn:hover {
          background: #ffffff;
          border-color: #f4c430;
          color: #f4c430;
          transform: translateX(-2px);
          box-shadow: 0 4px 12px rgba(244, 196, 48, 0.15);
        }

        .signup-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 56px;
          height: 56px;
          border-radius: 18px;
          background: linear-gradient(135deg, #f4c430, #f7d046);
          font-size: 24px;
          margin: 0 auto 16px;
          box-shadow: 0 8px 20px rgba(244, 196, 48, 0.35);
        }

        .signup-title {
          font-size: 22px;
          font-weight: 800;
          color: #111827;
          margin: 0 0 6px;
          text-align: center;
          letter-spacing: -0.3px;
        }

        .signup-subtitle {
          font-size: 14px;
          color: #6b7280;
          margin: 0 0 28px;
          text-align: center;
        }

        .signup-field {
          margin-bottom: 18px;
        }

        .signup-label {
          font-size: 11px;
          font-weight: 700;
          color: #374151;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          margin-bottom: 6px;
          display: block;
        }

        .signup-input-row {
          display: flex;
          align-items: center;
          background: #f9fafb;
          border: 1.5px solid #e5e7eb;
          border-radius: 14px;
          padding: 0 14px;
          height: 48px;
          transition: all 0.2s ease;
        }

        .signup-input-row:focus-within {
          border-color: #f4c430;
          background: #ffffff;
          box-shadow: 0 0 0 3px rgba(244, 196, 48, 0.18);
        }

        .signup-icon {
          font-size: 18px;
          color: #9ca3af;
          margin-right: 10px;
          flex-shrink: 0;
        }

        .signup-phone-prefix {
          font-size: 14px;
          font-weight: 700;
          color: #111827;
          margin-right: 10px;
          padding-right: 10px;
          border-right: 1.5px solid #e5e7eb;
        }

        .signup-input {
          flex: 1;
          border: none;
          background: transparent;
          outline: none;
          font-size: 14px;
          color: #111827;
          width: 100%;
        }

        .signup-input::placeholder {
          color: #9ca3af;
        }

        .signup-eye-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: #9ca3af;
          font-size: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          margin-left: 8px;
          transition: color 0.2s ease;
        }

        .signup-eye-btn:hover {
          color: #111827;
        }

        .signup-submit-btn {
          width: 100%;
          height: 50px;
          border-radius: 25px;
          border: none;
          background: linear-gradient(135deg, #f4c430, #f7d046);
          color: #111827;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          margin-top: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          box-shadow: 0 8px 20px rgba(244, 196, 48, 0.3);
          transition: all 0.25s ease;
        }

        .signup-submit-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 25px rgba(244, 196, 48, 0.4);
        }

        .signup-submit-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }

        /* PROMO POPUP MODAL STYLES */
        .promo-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(15, 23, 42, 0.65);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 20px;
          animation: fadeIn 0.3s ease;
        }

        .promo-modal-card {
          background: #ffffff;
          width: 100%;
          max-width: 420px;
          border-radius: 24px;
          padding: 36px 30px;
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.25);
          text-align: center;
          position: relative;
          animation: scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes scaleUp {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .promo-modal-badge {
          width: 64px;
          height: 64px;
          border-radius: 20px;
          background: linear-gradient(135deg, #f4c430, #f7d046);
          font-size: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 16px;
          box-shadow: 0 10px 24px rgba(244, 196, 48, 0.4);
        }

        .promo-modal-title {
          font-size: 22px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 8px;
        }

        .promo-modal-sub {
          font-size: 14px;
          color: #64748b;
          line-height: 1.5;
          margin: 0 0 20px;
        }

        .promo-coupon-box {
          background: #fffbeb;
          border: 2px dashed #f59e0b;
          border-radius: 16px;
          padding: 16px;
          margin-bottom: 24px;
        }

        .promo-coupon-label {
          font-size: 10px;
          font-weight: 800;
          color: #b45309;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          display: block;
          margin-bottom: 8px;
        }

        .promo-coupon-code-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 6px;
        }

        .promo-coupon-code {
          font-family: monospace;
          font-size: 20px;
          font-weight: 800;
          color: #1e293b;
          letter-spacing: 1px;
        }

        .promo-coupon-tag {
          background: #f4c430;
          color: #0f172a;
          font-size: 12px;
          font-weight: 800;
          padding: 4px 10px;
          border-radius: 12px;
        }

        .promo-coupon-note {
          font-size: 12px;
          color: #d97706;
          font-weight: 600;
          margin: 0;
        }

        .promo-modal-claim-btn {
          width: 100%;
          height: 52px;
          border-radius: 26px;
          border: none;
          background: linear-gradient(135deg, #f4c430, #f7d046);
          color: #0f172a;
          font-size: 16px;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 0 10px 25px rgba(244, 196, 48, 0.4);
          transition: all 0.25s ease;
        }

        .promo-modal-claim-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 14px 30px rgba(244, 196, 48, 0.5);
        }

        @media (max-width: 480px) {
          .signup-card {
            padding: 32px 24px 28px;
            border-radius: 20px;
          }
          .promo-modal-card {
            padding: 28px 20px;
          }
        }
      `}</style>
    </div>
  );
}

export default Signup;

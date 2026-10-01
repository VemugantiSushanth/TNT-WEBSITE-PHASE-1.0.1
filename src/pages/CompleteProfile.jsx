import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../components/supabaseClient";
import { FiUser, FiMail, FiPhone, FiLock, FiEye, FiEyeOff, FiChevronLeft } from "react-icons/fi";
import { useToast } from "../components/Toast/ToastContext";
import "./CompleteProfile.css";

function CompleteProfile() {
    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [isGoogleUser, setIsGoogleUser] = useState(false);

    const navigate = useNavigate();
    const toast = useToast();

    useEffect(() => {
        const getSessionData = async () => {
            try {
                const { data: { session }, error: sessionError } = await supabase.auth.getSession();
                if (sessionError) throw sessionError;

                if (!session?.user) { navigate("/login"); return; }

                const currentUser = session.user;

                // Test the session with a light query to catch JWT errors
                const { error: profileError } = await supabase
                    .from("profile")
                    .select("id")
                    .eq("id", currentUser.id)
                    .maybeSingle();

                if (profileError) throw profileError;

                if (currentUser.user_metadata?.full_name) setFullName(currentUser.user_metadata.full_name);
                if (currentUser.email) setEmail(currentUser.email);
                if (currentUser.phone) {
                    const cleanPhone = currentUser.phone.replace(/\D/g, "");
                    setPhone(cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone);
                }

                const isGoogle = currentUser.app_metadata?.provider?.toLowerCase() === "google"
                    || currentUser.identities?.some(i => i.provider?.toLowerCase() === "google");
                setIsGoogleUser(!!isGoogle);
            } catch (error) {
                console.error("Session initialization error:", error);
                if (error.message?.includes("JWT") || error.message?.includes("sub claim")) {
                    await supabase.auth.signOut();
                    // Fallback: Aggressively clear local storage if signout fails or token is stuck
                    Object.keys(localStorage).forEach(key => {
                        if (key.includes("supabase.auth.token") || key.startsWith("sb-")) {
                            localStorage.removeItem(key);
                        }
                    });
                    navigate("/login");
                }
            }
        };

        getSessionData();

        const { data: listener } = supabase.auth.onAuthStateChange((_, session) => {
            // Updated session handled by useEffect logic
        });

        return () => listener.subscription.unsubscribe();
    }, [navigate]);




    /* ── Save profile ── */
    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!fullName.trim()) return toast.warning("Please enter your full name.");
        if (!email.trim() || !email.includes("@")) return toast.warning("Please enter a valid email address.");
        if (phone.replace(/\D/g, "").length !== 10) return toast.warning("Please enter a valid 10-digit phone number.");

        // Only require password if NOT a Google user OR if they've started typing one
        const needsPassword = !isGoogleUser || (password && password.length > 0);
        if (needsPassword) {
            if (!password || password.length < 6) return toast.warning("Password must be at least 6 characters.");
            if (password !== confirmPassword) return toast.warning("Passwords do not match.");
        }

        setLoading(true);
        try {
            // ✅ Get fresh session
            const { data: { session } } = await supabase.auth.getSession();
            let freshUser = session?.user;

            if (!freshUser) {
                const { data: { user: backupUser } } = await supabase.auth.getUser();
                freshUser = backupUser;
            }

            if (!freshUser) throw new Error("No authenticated user found. Please log in again.");

            const formattedPhone = `+91${phone.replace(/\D/g, "")}`;

            // 1. Update Auth Metadata
            const { error: metaError } = await supabase.auth.updateUser({
                data: {
                    full_name: fullName,
                    phone_number: formattedPhone,
                },
            });

            if (metaError) {
                console.error("Auth metadata update failed:", metaError);
                throw new Error("Login service update failed: " + metaError.message);
            }

            // 2. Update Password if provided
            if (password) {
                try {
                    const { error: passError } = await supabase.auth.updateUser({ password });
                    if (passError) throw passError;
                } catch (passErr) {
                    console.error("Password update error:", passErr);
                    toast.error("Failed to set password: " + passErr.message);
                    // This might be fatal depending on requirements, but let's try to continue if metadata/DB is okay
                }
            }

            // 3. Update Profile table (CRITICAL)
            const { error: profileError } = await supabase.from("profile").upsert({
                id: freshUser.id,
                full_name: fullName,
                email,
                phone: formattedPhone,
            });
            if (profileError) {
                console.error("Profile table update error:", profileError);
                throw new Error("Could not save profile to database: " + profileError.message);
            }

            // 4. Update Signup table
            const { error: signupError } = await supabase.from("signup").upsert({
                id: freshUser.id,
                full_name: fullName,
                email,
                phone: formattedPhone,
            });
            if (signupError) console.warn("Signup table update failed:", signupError);


            toast.success("Profile saved successfully! 🎉");
            navigate("/services");
        } catch (err) {
            console.error("Save process error:", err);
            toast.error(err.message || "An unexpected error occurred.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="cp-page">
            <div className="cp-card">
                <button
                    type="button"
                    className="cp-back-btn"
                    onClick={async () => {
                        await supabase.auth.signOut();
                        navigate("/login");
                    }}
                    aria-label="Go back"
                >
                    <FiChevronLeft />
                </button>
                <div className="cp-header">
                    <div className="cp-badge">✏️</div>
                    <h2 className="cp-title">Complete Your Profile</h2>
                    <p className="cp-subtitle">Just a few details to get you started.</p>
                </div>

                <form onSubmit={handleSubmit}>

                    {/* Full Name */}
                    <div className="cp-field">
                        <label className="cp-label">Full Name</label>
                        <div className="cp-input-row">
                            <FiUser className="cp-icon" />
                            <input type="text" className="cp-input" placeholder="Your full name"
                                value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={loading} />
                        </div>
                    </div>

                    {/* Email */}
                    <div className="cp-field">
                        <label className="cp-label">Email Address</label>
                        <div className="cp-input-row">
                            <FiMail className="cp-icon" />
                            <input type="email" className="cp-input" placeholder="you@email.com"
                                value={email} onChange={(e) => setEmail(e.target.value)}
                                disabled={loading || isGoogleUser} />
                        </div>
                    </div>

                    {/* Phone Number */}
                    <div className="cp-field">
                        <label className="cp-label">Phone Number</label>

                        {/* Phone input row */}
                        <div className="cp-input-row">
                            <FiPhone className="cp-icon" />
                            <span className="cp-phone-prefix">+91</span>
                            <input
                                type="tel"
                                className="cp-input cp-input-phone"
                                placeholder="10-digit mobile number"
                                value={phone}
                                onChange={(e) => {
                                    setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                                }}
                                disabled={loading}
                            />
                        </div>
                    </div>

                    {/* Password */}
                    <div className="cp-field">
                        <label className="cp-label">Create Password</label>
                        <div className="cp-input-row">
                            <FiLock className="cp-icon" />
                            <input type={showPassword ? "text" : "password"} className="cp-input"
                                placeholder="Min. 6 characters" value={password}
                                onChange={(e) => setPassword(e.target.value)} disabled={loading} />
                            <button type="button" className="cp-eye" onClick={() => setShowPassword(!showPassword)}>
                                {showPassword ? <FiEye /> : <FiEyeOff />}
                            </button>
                        </div>
                    </div>

                    {/* Confirm Password */}
                    <div className="cp-field">
                        <label className="cp-label">Confirm Password</label>
                        <div className="cp-input-row">
                            <FiLock className="cp-icon" />
                            <input type={showConfirmPassword ? "text" : "password"} className="cp-input"
                                placeholder="Re-enter password" value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)} disabled={loading} />
                            <button type="button" className="cp-eye" onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                                {showConfirmPassword ? <FiEye /> : <FiEyeOff />}
                            </button>
                        </div>
                    </div>

                    <button type="submit" className="cp-btn" disabled={loading}>
                        {loading ? "Saving..." : "Save & Continue →"}
                    </button>

                    {isGoogleUser && (
                        <p className="cp-hint" style={{ marginTop: "10px", fontSize: "0.85rem", opacity: 0.8 }}>
                            Setting a password is optional for Google users.
                        </p>
                    )}
                </form>
            </div>
        </div>
    );
}

export default CompleteProfile;
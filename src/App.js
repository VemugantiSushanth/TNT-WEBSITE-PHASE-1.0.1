import React, { useEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { supabase } from "./components/supabaseClient";
import { ToastProvider } from "./components/Toast/ToastContext";
import { ConfirmProvider } from "./components/ConfirmModal/ConfirmModal";
import "./components/Toast/Toast.css";

/* COMPONENTS */
import ScrollToTop from "./components/ScrollToTop";
import PageLoader from "./components/PageLoader";
import Footer from "./components/Footer";


/* PAGES */
import Login from "./pages/Login";
import Signup from "./pages/SignUp";
import Services from "./Services";
import Profile from "./pages/Profile";
import ServiceDetail from "./pages/ServiceDetail";
import Booking from "./pages/Booking";
import Payment from "./pages/Payment";
import MyBookings from "./pages/MyBookings";
import BookingDetails from "./pages/BookingDetails";
import CompletedBookings from "./pages/CompletedBookings";
import ForgotPassword from "./pages/ForgotPassword";
import UpdatePassword from "./pages/UpdatePassword";
import CompleteProfile from "./pages/CompleteProfile";
import AuthCallback from "./pages/AuthCallback";
// import NewUser from "./pages/NewUser";
// import Download from "./pages/Download"; // Removed

/* ---------------- PAGE TO PAGE LOADER ---------------- */

function PageTransitionLoader() {
  const location = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);

    const timer = setTimeout(() => {
      setVisible(false);
    }, 450);

    return () => clearTimeout(timer);
  }, [location.pathname]);

  if (!visible) return null;
  return <PageLoader />;
}

/* ---------------- APP LAYOUT ---------------- */

function AppLayout({ user, isRecovery }) {
  const location = useLocation();
  const navigate = useNavigate();

  const [showChecklistSuccess, setShowChecklistSuccess] = useState(false);

  useEffect(() => {
    if (
      location.pathname === "/services" &&
      location.state?.checklistSubmissionSuccess === true
    ) {
      setShowChecklistSuccess(true);

      // Clear the navigation signal so the popup
      // does not appear again after refreshing.
      navigate(
        {
          pathname: location.pathname,
          search: location.search,
        },
        {
          replace: true,
          state: null,
        }
      );
    }
  }, [location.pathname, location.search, location.state, navigate]);


  const hideFooterRoutes = ["/login", "/signup", "/profile", "/update-password", "/forgot-password", "/new-user"];


  const [footerReady, setFooterReady] = useState(false);

  useEffect(() => {
    setFooterReady(false);

    requestAnimationFrame(() => {
      setTimeout(() => {
        setFooterReady(true);
      }, 600);
    });
  }, [location.pathname]);

  const hideFooter =
    hideFooterRoutes.includes(location.pathname) || !footerReady;

  /* ---------------- PROFILE ENFORCEMENT ---------------- */
  const [profileLoading, setProfileLoading] = useState(false);
  useEffect(() => {
    const excludedRoutes = ["/complete-profile", "/login", "/signup", "/auth/callback", "/forgot-password", "/update-password"];

    const checkProfile = async () => {
      // If no user or on excluded route, don't check
      if (!user || excludedRoutes.includes(location.pathname)) return;

      setProfileLoading(true);
      try {
        const { data, error } = await supabase
          .from("profile")
          .select("full_name, phone")
          .eq("id", user.id)
          .maybeSingle();

        if (error) throw error;

        // If no profile or missing key info, redirect
        if (!data || !data.full_name || !data.phone) {
          navigate("/complete-profile", { replace: true });
        }
      } catch (err) {
        console.error("Profile check error:", err);
        if (err.message?.includes("JWT") || err.message?.includes("sub claim")) {
          // Force sign out and clear storage
          await supabase.auth.signOut();
          Object.keys(localStorage).forEach(key => {
            if (key.includes("supabase.auth.token") || key.startsWith("sb-")) {
              localStorage.removeItem(key);
            }
          });
          window.location.href = "/login";
        }
      } finally {
        setProfileLoading(false);
      }
    };

    checkProfile();
  }, [user, location.pathname, navigate]);

  // If this is a recovery session, go directly to update password
  // This is checked synchronously during render to prevent the /services redirect
  if (isRecovery && location.pathname !== "/update-password") {
    return <Navigate to="/update-password" replace />;
  }

  return (
    <>
      <PageTransitionLoader />
      {profileLoading && location.pathname !== "/complete-profile" && <PageLoader />}

      <Routes>
        {/* ✅ FIXED */}
        <Route
          path="/"
          element={<Navigate to="/services" replace />}
        />

        <Route
          path="/login"
          element={user && !isRecovery ? <Navigate to="/services" /> : <Login />}
        />
        <Route
          path="/signup"
          element={<Signup user={user} />}
        />

        <Route path="/services" element={<Services user={user} />} />
        <Route path="/services/:categorySlug" element={<Services user={user} />} />
        <Route path="/service/:id" element={<ServiceDetail user={user} />} />

        <Route
          path="/profile"
          element={user ? <Profile /> : <Navigate to="/login" />}
        />
        <Route
          path="/booking"
          element={user ? <Booking user={user} /> : <Navigate to="/login" />}
        />
        <Route
          path="/payment"
          element={user ? <Payment user={user} /> : <Navigate to="/login" />}
        />
        <Route
          path="/my-bookings"
          element={user ? <MyBookings user={user} /> : <Navigate to="/login" />}
        />
        <Route
          path="/booking-details/:id"
          element={user ? <BookingDetails /> : <Navigate to="/login" />}
        />
        <Route
          path="/completed-bookings/:id"
          element={<CompletedBookings />}
        />

        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/update-password" element={<UpdatePassword />} />
        <Route path="/complete-profile" element={<CompleteProfile />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        {/* <Route path="/new-user" element={<NewUser />} /> */}

        {/* ✅ ONLY ADDED ROUTE */}
        {/* Route removed: Download */}

        {/* ✅ FIXED */}
        <Route
          path="*"
          element={<Navigate to="/services" replace />}
        />
      </Routes>

      {!hideFooter && <Footer />}

      {showChecklistSuccess && (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(6px)",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="checklist-success-title"
            style={{
              width: "100%",
              maxWidth: "420px",
              padding: "36px 28px",
              background: "#ffffff",
              borderRadius: "24px",
              textAlign: "center",
              boxShadow: "0 24px 60px rgba(0,0,0,0.2)",
            }}
          >
            <div
              style={{
                width: "72px",
                height: "72px",
                margin: "0 auto 20px",
                borderRadius: "50%",
                background: "#dcfce7",
                color: "#16a34a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "38px",
                fontWeight: "bold",
              }}
            >
              ✓
            </div>

            <h2
              id="checklist-success-title"
              style={{
                fontSize: "23px",
                fontWeight: "800",
                color: "#111827",
                marginBottom: "14px",
              }}
            >
              Checklist Submitted Successfully!
            </h2>

            <p
              style={{
                color: "#64748b",
                fontSize: "14px",
                lineHeight: "1.7",
                marginBottom: "26px",
              }}
            >
              Thank you for verifying the completed service.
              Your checklist has been saved successfully.
              Our service partner can now complete the booking.
            </p>

            <button
              type="button"
              onClick={() => setShowChecklistSuccess(false)}
              style={{
                width: "100%",
                padding: "14px 20px",
                background: "#f4c430",
                border: "none",
                borderRadius: "12px",
                color: "#111827",
                fontSize: "15px",
                fontWeight: "800",
                cursor: "pointer",
              }}
            >
              Continue to Home
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------- ROOT APP ---------------- */

// Check for recovery token SYNCHRONOUSLY at module level - runs before any React render
const RECOVERY_HASH_DETECTED = typeof window !== "undefined" &&
  (window.location.hash.includes("type=recovery") ||
    new URLSearchParams(window.location.search).get("type") === "recovery");

export default function App() {
  const [user, setUser] = useState(null);
  const [showLoader, setShowLoader] = useState(true);
  // Synchronous initial value from module-level check
  const [isRecovery, setIsRecovery] = useState(RECOVERY_HASH_DETECTED);

  useEffect(() => {
    const start = Date.now();

    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      setUser(session?.user ?? null);

      const MIN_TIME = 1000;
      const elapsed = Date.now() - start;

      setTimeout(() => {
        setShowLoader(false);
      }, Math.max(MIN_TIME - elapsed, 0));
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user ?? null);
        // Also catch PASSWORD_RECOVERY event dynamically
        if (event === "PASSWORD_RECOVERY") {
          setIsRecovery(true);
        }
        // After a successful password update, clear recovery mode
        if (event === "USER_UPDATED" || event === "SIGNED_OUT") {
          setIsRecovery(false);
        }
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  if (showLoader) {
    return <PageLoader />;
  }

  return (
    <ToastProvider>
      <ConfirmProvider>
        <Router>
          <ScrollToTop />
          <AppLayout user={user} isRecovery={isRecovery} />
        </Router>
      </ConfirmProvider>
    </ToastProvider>
  );
}
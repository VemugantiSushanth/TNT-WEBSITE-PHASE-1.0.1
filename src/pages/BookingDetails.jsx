import { useEffect, useState, useMemo, useCallback } from "react";
import { IoAlertCircleOutline, IoClose } from "react-icons/io5";
import { useNavigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { supabase } from "../components/supabaseClient";
import { formatDuration } from "../utils/durationUtils";

import { FiArrowLeft } from "react-icons/fi";
import { useToast } from "../components/Toast/ToastContext";
import ServiceChecklist from "../components/ServiceChecklist";
import "./BookingDetails.css";

const getCurrency = (value) => {
  if (!value) return "₹"; // Fallback
  const match = String(value).match(/^([^\d\s]+)/);
  return match ? match[1] : "₹";
};

export default function BookingDetails() {
  const { id } = useParams();
  const navigate = useNavigate();

  const toast = useToast();

  const [booking, setBooking] = useState(null);
  const [staffDetails, setStaffDetails] = useState({ name: "", phone: "" });
  const [loading, setLoading] = useState(true);

  // Synchronize booking status from ServiceChecklist Realtime.
  const handleBookingUpdate = useCallback((updatedBooking) => {
    setBooking((previous) => {
      if (!previous || previous.id !== updatedBooking.id) {
        return previous;
      }

      return {
        ...previous,
        ...updatedBooking,
      };
    });
  }, []);

  // Update the booking details after successful checklist submission.
  const handleChecklistSuccess = (updatedBooking) => {
    setBooking((previous) => {
      if (!previous || previous.id !== updatedBooking.id) {
        return previous;
      }

      return {
        ...previous,
        ...updatedBooking,
        checklist_submitted: true,
      };
    });

    navigate("/services", {
      replace: true,
      state: {
        checklistSubmissionSuccess: true,
      },
    });
  };

  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [rating, setRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState("");
  const [review, setReview] = useState(null);
  const [submittingReview, setSubmittingReview] = useState(false);

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [showCancelledPopup, setShowCancelledPopup] = useState(false);
  const [cancellationDetails, setCancellationDetails] = useState(null);
  const [fetchingFees, setFetchingFees] = useState(false);
  const [isEligibleToCancel, setIsEligibleToCancel] = useState(false);
  const [isFreeCancellation, setIsFreeCancellation] = useState(true);

  const services = useMemo(() => {
    if (!booking?.services) return [];
    if (Array.isArray(booking.services)) return booking.services;
    if (typeof booking.services === "string") {
      try {
        return JSON.parse(booking.services);
      } catch {
        return [];
      }
    }
    return [];
  }, [booking?.services]);

  const calculatedCancellationFee = useMemo(() => {
    if (!services || services.length === 0) return 99;
    return services.reduce((sum, s) => {
      if (s.cancellation_fee !== undefined && s.cancellation_fee !== null) {
        return sum + (Number(s.cancellation_fee) || 0);
      }
      // Fallback Rule
      const price = s.price ? parseFloat(String(s.price).replace(/[^\d.]/g, "")) : 0;
      const isDeepClean = (s.title || "").toLowerCase().includes("deep cleaning") ||
        (s.service_type || "").toLowerCase().includes("deep cleaning");
      return sum + ((price >= 2000 || isDeepClean) ? 299 : 99);
    }, 0);
  }, [services]);

  // Check Cancellation Eligibility (6 hours before service)
  useEffect(() => {
    if (!booking) return;

    let eligible = true;
    let free = true;

    if (booking.booking_date && booking.booking_time) {
      try {
        const scheduledStr = `${booking.booking_date} ${booking.booking_time}`;
        const scheduledDate = new Date(scheduledStr);
        const now = new Date();
        const diffHours = (scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60);

        // Can cancel until the service starts (even if fee applies)
        if (diffHours < 0) {
          eligible = false;
        }

        // Free only if > 6 hours before
        if (diffHours <= 6) {
          free = false;
        }

        if (["CANCELLED", "COMPLETED", "FAILED"].includes(booking.work_status?.toUpperCase())) {
          eligible = false;
          free = false;
        }
      } catch (e) {
        console.error("Error parsing booking date:", e);
      }
    }
    setIsEligibleToCancel(eligible);
    setIsFreeCancellation(free);
  }, [booking]);

  useEffect(() => {
    const fetchBooking = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("bookings")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

      if (data) {
        setBooking(data);

        // ✅ ROBUST STAFF NAME FETCHING
        if (data.assigned_staff_email) {
          const fetchStaffName = async (email) => {
            console.log("[Staff Debug] Starting fetch for email:", email);
            try {
              // 1. Check staff_profile (Schema: name, phone)
              const { data: sProfile, error: sError } = await supabase
                .from("staff_profile")
                .select("name, phone")
                .eq("email", email)
                .maybeSingle();

              if (sError) console.error("[Staff Debug] staff_profile error:", sError);
              if (sProfile?.name) {
                console.log("[Staff Debug] Found in staff_profile:", sProfile);
                return {
                  name: sProfile.name,
                  phone: sProfile.phone || "No mobile number"
                };
              }

              // 2. Check profile table (Schema: full_name, phone)
              const { data: uProfile, error: uError } = await supabase
                .from("profile")
                .select("full_name, phone")
                .eq("email", email)
                .maybeSingle();

              if (uError) console.error("[Staff Debug] profile table error:", uError);
              if (uProfile?.full_name) {
                console.log("[Staff Debug] Found in profile table:", uProfile);
                return {
                  name: uProfile.full_name,
                  phone: uProfile.phone || "No mobile number"
                };
              }

              // 3. Check signup table (Schema: full_name, phone)
              const { data: sSignup, error: qError } = await supabase
                .from("signup")
                .select("full_name, phone")
                .eq("email", email)
                .maybeSingle();

              if (qError) console.error("[Staff Debug] signup table error:", qError);
              if (sSignup?.full_name) {
                console.log("[Staff Debug] Found in signup table:", sSignup);
                return {
                  name: sSignup.full_name,
                  phone: sSignup.phone || "No mobile number"
                };
              }

              console.warn("[Staff Debug] No profile found for email in any table.");
              return null;
            } catch (err) {
              console.error("[Staff Debug] UNEXPECTED error:", err);
              return null;
            }
          };

          const details = await fetchStaffName(data.assigned_staff_email);
          if (details) setStaffDetails(details);
        } else {
          setStaffDetails({ name: "", phone: "" });
        }

        if (data.work_status?.toUpperCase() === "COMPLETED") {
          const { data: reviewData } = await supabase
            .from("reviews")
            .select("*")
            .eq("booking_id", data.id)
            .eq("user_id", user.id)
            .maybeSingle();

          if (reviewData) {
            setReview(reviewData);
            setRating(reviewData.rating);
            setFeedbackText(reviewData.comment);
          }
        }
      }

      setLoading(false);
    };

    fetchBooking();
  }, [id]);


  /* HANDLE CANCEL CLICK */
  const handleCancelClick = async () => {
    if (
      ["UNDER_REVIEW", "COMPLETED", "CANCELLED", "FAILED"].includes(
        String(booking?.work_status || "").trim().toUpperCase()
      )
    ) {
      toast.warning("Cancellation is unavailable for this booking.");
      return;
    }
    if (!isEligibleToCancel) {
      toast.info("Cancellation is no longer available.");
      return;
    }

    setFetchingFees(true);
    try {
      let { data, error } = await supabase.rpc('calculate_cancellation_details', {
        booking_uuid: booking.id
      });

      if (error) throw error;

      // Enforce cancellation fee policy in frontend using dynamic cancellation fee
      const fee = isFreeCancellation ? 0 : calculatedCancellationFee;
      data = {
        ...data,
        fee: fee,
        total_amount: data?.total_amount || booking.total_amount,
        refund_amount: Math.max(0, (data?.total_amount || booking.total_amount || 0) - fee)
      };

      setCancellationDetails(data);
      setShowCancelModal(true);
    } catch (err) {
      console.error("Error fetching cancellation details:", err);
      const fee = isFreeCancellation ? 0 : calculatedCancellationFee;
      setCancellationDetails({
        fee: fee,
        total_amount: booking.total_amount,
        refund_amount: Math.max(0, (booking.total_amount || 0) - fee)
      });
      setShowCancelModal(true);
    } finally {
      setFetchingFees(false);
    }
  };

  /* CONFIRM CANCEL */
  const confirmCancellation = async () => {
    if (!cancelReason.trim()) {
      toast.warning("Please provide a reason.");
      return;
    }

    setCancelling(true);

    try {
      const { error } = await supabase
        .from("bookings")
        .update({
          work_status: "CANCELLED",
          cancel_requested: true,
          cancel_reason: cancelReason,
          cancel_time: new Date().toISOString(),
          refund_status: "PENDING",
          cancellation_fee: cancellationDetails?.fee || 0,
          refund_amount: cancellationDetails?.refund_amount || booking.total_amount,
        })
        .eq("id", booking.id);

      if (error) throw error;

      setShowCancelModal(false);
      setShowCancelledPopup(true);
    } catch (err) {
      toast.error("Cancellation failed.");
      console.error(err);
    } finally {
      setCancelling(false);
    }
  };

  const openFeedbackModal = () => {
    setShowFeedbackModal(true);
  };

  const submitReview = async () => {
    if (!rating) {
      toast.warning("Please select a rating.");
      return;
    }

    setSubmittingReview(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: existing } = await supabase
        .from("reviews")
        .select("id")
        .eq("booking_id", booking.id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("reviews")
          .update({
            rating,
            comment: feedbackText,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("reviews").insert([
          {
            booking_id: booking.id,
            user_id: user.id,
            rating,
            comment: feedbackText,
          },
        ]);
      }

      setReview({
        rating,
        comment: feedbackText,
      });

      setShowFeedbackModal(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to submit review");
    } finally {
      setSubmittingReview(false);
    }
  };

  if (loading) return <p className="loading">Loading...</p>;
  if (!booking) return <p>No booking found</p>;


  const normalizedWorkStatus = String(
    booking.work_status || ""
  ).trim().toUpperCase();

  const showCancelButton =
    ![
      "CANCELLED",
      "COMPLETED",
      "FAILED",
      "UNDER_REVIEW"
    ].includes(normalizedWorkStatus) &&
    booking.cancel_requested === false &&
    isEligibleToCancel;

  return (
    <>
      <Helmet>
        <title>Booking Details | The Neatify Team</title>
        <link rel="canonical" href={`https://www.theneatifyteam.in/booking-details/${id}`} />
      </Helmet>
      <div className="booking-details-container">
        <button className="back-btn-top" onClick={() => navigate("/my-bookings")}>
          <FiArrowLeft /> Back
        </button>

        <h2>Booking Details</h2>

        {/* CANCELLATION POLICY MESSAGE */}
        {!["CANCELLED", "COMPLETED", "FAILED"].includes(booking.work_status?.toUpperCase()) && (
          <div className={isFreeCancellation ? "policy-card-info" : "policy-card-expired"}>
            <IoAlertCircleOutline style={{ fontSize: '18px', flexShrink: 0 }} />
            <p>
              {isFreeCancellation
                ? "You can cancel this booking free of charge up to 6 hours before service."
                : `Cancellation within 6 hours of service incurs a fee (₹${calculatedCancellationFee}).`}
            </p>
          </div>
        )}

        <p className="section">Customer Details</p>
        <div className="card">
          <p className="bold">{booking.customer_name}</p>
          <p>{booking.email}</p>
          <p>{booking.phone_number}</p>
        </div>

        <p className="section">Service Details</p>
        <div className="card">
          {services.map((s, i) => (
            <div key={i} className="service-row">
              <div>
                <p className="bold">{s.title || s.service_name}</p>
                <p>
                  {formatDuration(s.duration)}
                </p>
              </div>
              <p className="bold">{s.price}</p>
            </div>
          ))}
        </div>

        <p className="section">Schedule</p>
        <div className="card">
          <p>{booking.booking_date} at {booking.booking_time}</p>
        </div>

        <p className="section">Payment</p>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p className="bold">Total</p>
            <p className="bold">{services && services[0] ? getCurrency(services[0].price) : "₹"}{booking.total_amount}</p>
          </div>
          <p style={{ marginTop: '4px', fontSize: '14px', color: '#6b7280' }}>
            Status: {booking.payment_status || "pending"}
          </p>

          {/* CANCELLATION FEE BREAKDOWN */}
          {booking.work_status === "CANCELLED" && (
            <div style={{ marginTop: '12px', borderTop: '1px solid #f3f4f6', paddingTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <p style={{ fontSize: '14px', color: '#4b5563' }}>Cancellation Fee</p>
                <p style={{ fontSize: '14px', fontWeight: '600', color: '#b91c1c' }}>₹{booking.cancellation_fee || 0}</p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <p style={{ fontSize: '14px', color: '#4b5563' }}>Refund Amount</p>
                <p style={{ fontSize: '14px', fontWeight: '600', color: '#166534' }}>₹{booking.refund_amount || 0}</p>
              </div>
            </div>
          )}

          {/* INTEGRATED REFUND STATUS */}
          {booking.work_status === "CANCELLED" && (
            <div style={{
              fontSize: '13px',
              color: booking.refund_status === "REFUNDED" ? "#166534" : "#b91c1c",
              fontWeight: '600',
              marginTop: '8px',
              borderTop: '1px solid #f3f4f6',
              paddingTop: '8px'
            }}>
              {booking.refund_status === "REFUNDED"
                ? "✓ Refund Completed"
                : "⏳ Refund Pending (5–7 working days)"}
            </div>
          )}
        </div>

        {(booking.payment_status !== "failed" && booking.work_status?.toUpperCase() !== "CANCELLED" && booking.work_status?.toUpperCase() !== "FAILED" && booking.work_status?.toUpperCase() !== "COMPLETED") && (
          <>
            <p className="section">Staff Assignment</p>
            <div className="card">
              {booking.assigned_staff_email ? (
                <>
                  <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: '#166534', fontWeight: '600' }}>
                    <span>✓</span> Staff Assigned
                  </div>
                  <div style={{ padding: '8px 0' }}>
                    <p className="staff-info-item">
                      <span className="staff-info-label">Name:</span> {staffDetails.name || "Name not available"}
                    </p>
                    <p className="staff-info-item">
                      <span className="staff-info-label">Mobile:</span> {staffDetails.phone || "Number not available"}
                    </p>
                  </div>

                  {/* OTP SECTION INSIDE STAFF CARD */}
                  <div className="otp-container" style={{ marginTop: '20px', borderTop: '1px solid #f3f4f6', paddingTop: '20px' }}>
                    <div className="otp-box">
                      <p className="otp-label">Start OTP</p>
                      <p className="otp-code">
                        {booking.startotp || "N/A"}
                      </p>
                      <p className="otp-subtext">Share with staff to start service</p>
                    </div>
                    <div className="otp-box">
                      <p className="otp-label">End OTP</p>
                      <p className="otp-code">
                        {booking.endotp || "N/A"}
                      </p>
                      <p className="otp-subtext">Share with staff after service</p>
                    </div>
                  </div>
                </>
              ) : (
                <p>Staff will be assigned shortly</p>
              )}
            </div>
          </>
        )}

        {/* ==========================================
            CUSTOMER SERVICE CHECKLIST
            Locked until work_status = UNDER_REVIEW
            ========================================== */}

        <ServiceChecklist
          key={booking.id}
          booking={booking}
          onSuccess={handleChecklistSuccess}
          onBookingUpdate={handleBookingUpdate}
        />

        <div className="actions-container">
          {showCancelButton && (
            <button
              className="cancel-btn"
              onClick={handleCancelClick}
              disabled={cancelling || fetchingFees}
            >
              {cancelling ? "Processing..." : fetchingFees ? "Checking Fees..." : "✕ Cancel Booking"}
            </button>
          )}
        </div>

        {showCancelModal && (
          <div className="modal-overlay">
            <div className="modal cancel-modal">
              <button
                className="modal-close-x"
                onClick={() => setShowCancelModal(false)}
                disabled={cancelling}
              >
                <IoClose />
              </button>

              <div className="modal-icon-cancel warning-icon-cancel">
                <IoAlertCircleOutline />
              </div>

              <h3>Cancel Booking?</h3>

              {/* CANCELLATION SUMMARY */}
              {cancellationDetails && (
                <div className="fee-summary-card">
                  <div className="fee-summary-row">
                    <span>Total Amount</span>
                    <span className="bold">₹{cancellationDetails.total_amount}</span>
                  </div>
                  <div className="fee-summary-row">
                    <span>Cancellation Charge</span>
                    <span className={cancellationDetails.fee > 0 ? "fee-amount danger" : "fee-amount success"}>
                      {cancellationDetails.fee > 0 ? `- ₹${cancellationDetails.fee}` : "FREE"}
                    </span>
                  </div>
                  <div className="fee-summary-row fee-total-row">
                    <span className="bold">Final Refund</span>
                    <span className="bold refund-total">₹{cancellationDetails.refund_amount}</span>
                  </div>
                  {cancellationDetails.fee > 0 && (
                    <p className="fee-note">* Fee applied as per policy (within 6 hours of service).</p>
                  )}
                </div>
              )}

              <p className="modal-subtitle-cancel">
                Are you sure you want to cancel this booking? This action cannot
                be undone.
              </p>

              <div className="form-group-cancel">
                <label className="modal-label-cancel">
                  Reason for cancellation
                </label>
                <textarea
                  placeholder="Enter reason here..."
                  className="modal-textarea-cancel"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
              </div>

              <div className="modal-actions-cancel">
                <button
                  className="secondary-btn-cancel"
                  onClick={() => setShowCancelModal(false)}
                  disabled={cancelling}
                >
                  Keep Booking
                </button>

                <button
                  className="danger-btn-cancel"
                  onClick={confirmCancellation}
                  disabled={cancelling}
                >
                  {cancelling ? "Cancelling..." : "Confirm Cancel"}
                </button>
              </div>
            </div>
          </div>
        )}

        {showCancelledPopup && (
          <div className="modal-overlay">
            <div className="modal success-modal">
              <div className="modal-icon-success">
                <span className="checkmark-icon">✓</span>
              </div>
              <h3>Cancelled!</h3>
              <p className="modal-subtitle-success">
                Your booking has been cancelled successfully. Refund will be
                processed as per policy.
              </p>
              <button
                className="success-btn"
                onClick={() => navigate("/my-bookings")}
              >
                Back to My Bookings
              </button>
            </div>
          </div>
        )}

        {/* ===== FEEDBACK DISPLAY ===== */}
        {booking.work_status?.toUpperCase() === "COMPLETED" && (
          <div style={{ marginTop: "16px" }}>
            {review && (
              <div className="card">
                <p style={{ fontWeight: "600", marginBottom: "12px" }}>
                  Your Feedback
                </p>

                {/* TEXT FIRST */}
                <p
                  style={{
                    color: "#374151",
                    marginBottom: "14px",
                    lineHeight: "1.6",
                  }}
                >
                  {review.comment}
                </p>

                {/* RATING BELOW */}
                <div>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span
                      key={star}
                      style={{
                        color: star <= review.rating ? "#facc15" : "#e5e7eb",
                        fontSize: "20px",
                        marginRight: "4px",
                      }}
                    >
                      ★
                    </span>
                  ))}
                </div>
              </div>
            )}

            <button className="edit-feedback-btn" onClick={openFeedbackModal}>
              {review ? "Edit Feedback" : "Give Feedback"}
            </button>
          </div>
        )}

        {/* ===== FEEDBACK MODAL ===== */}
        {showFeedbackModal && (
          <div
            className="modal-overlay"
            onClick={() => {
              if (rating === 1) {
                setRating(0); // 🔥 Only remove when exactly 1 star selected
              }
            }}
          >
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              {/* CLOSE X BUTTON */}
              <span
                className="modal-close-x"
                onClick={() => setShowFeedbackModal(false)}
              >
                ×
              </span>

              <h3>Rate Your Experience</h3>

              {/* TEXTAREA FIRST */}
              <textarea
                placeholder="Write your feedback..."
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
              />

              {/* RATING BELOW */}
              <div className="rating-stars" style={{ marginTop: "18px" }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <span
                    key={star}
                    className={star <= rating ? "star-active" : "star-inactive"}
                    onClick={() => {
                      if (rating === star) {
                        setRating(0); // toggle off
                      } else {
                        setRating(star);
                      }
                    }}
                  >
                    ★
                  </span>
                ))}
              </div>

              <div className="modal-actions">
                <button onClick={() => setShowFeedbackModal(false)}>
                  Cancel
                </button>

                <button onClick={submitReview} disabled={submittingReview}>
                  {submittingReview ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
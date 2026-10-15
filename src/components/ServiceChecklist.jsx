
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { useToast } from "./Toast/ToastContext";
import "./ServiceChecklist.css";

const normalizeStatus = (value) =>
    String(value ?? "").trim().toUpperCase();

const isSubmitted = (value) =>
    value === true || String(value ?? "").trim().toUpperCase() === "TRUE";

function getServiceChecklist(servicesInput) {
    let services = [];

    if (Array.isArray(servicesInput)) {
        services = servicesInput;
    } else if (typeof servicesInput === "string") {
        try {
            const parsed = JSON.parse(servicesInput);
            services = Array.isArray(parsed) ? parsed : [];
        } catch {
            services = [];
        }
    }

    const serviceName = String(
        services[0]?.title || services[0]?.service_name || ""
    ).toLowerCase();

    if (serviceName.includes("bathroom")) {
        return [
            "Customer & property details verified",
            "Floor, tiles, toilet, wash basin & fixtures cleaned",
            "Mirrors & glass surfaces wiped",
            "Exhaust fan & switchboards cleaned",
            "Cobwebs removed",
            "Final inspection completed & customer satisfied",
        ];
    }

    if (serviceName.includes("kitchen")) {
        return [
            "Customer & property details verified",
            "Countertop, hob, sink, cabinets & floor completed",
            "Chimney exterior wiped",
            "Appliances exterior wiped",
            "Exhaust fan & switchboards cleaned",
            "Final inspection completed & customer satisfied",
        ];
    }

    if (serviceName.includes("sofa")) {
        return [
            "Customer & property details verified",
            "Dry vacuuming of sofa completed",
            "Shampooing and wet vacuuming completed",
            "Cushions properly cleaned",
            "Stains spot-treated",
            "Final inspection completed & customer satisfied",
        ];
    }

    if (serviceName.includes("window") || serviceName.includes("door")) {
        return [
            "Customer & property details verified",
            "Window panes & glass cleaned",
            "Tracks & channels vacuumed/wiped",
            "Mosquito nets brushed",
            "Doors & frames wiped",
            "Final inspection completed & customer satisfied",
        ];
    }

    if (serviceName.includes("balcony")) {
        return [
            "Customer & property details verified",
            "Balcony floor scrubbed & washed",
            "Railings wiped & cleaned",
            "Cobwebs removed",
            "Final inspection completed & customer satisfied",
        ];
    }

    if (serviceName.includes("express")) {
        return [
            "Customer & property details verified",
            "Dry dusting of all rooms completed",
            "Floors swept and mopped",
            "Basic tidying up of living spaces",
            "Final inspection completed & customer satisfied",
        ];
    }

    return [
        "Customer & property details verified",
        "Required areas/access confirmed",
        "Service scope & requirements confirmed",
        "Cleaning materials & equipment available",
        "All selected service areas cleaned",
        "Floors, surfaces & fixtures properly cleaned",
        "Kitchen, bathrooms & applicable areas completed",
        "Windows/glass & included tasks completed",
        "No visible dirt or waste left behind",
        "Final inspection completed & customer satisfied",
    ];
}

export default function ServiceChecklist({
    booking,
    onSuccess,
    onBookingUpdate,
}) {
    const toast = useToast();
    const bookingId = booking?.id;
    const [currentBooking, setCurrentBooking] = useState(booking);
    const [checklist, setChecklist] = useState({});
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const submittingRef = useRef(false);

    useEffect(() => {
        setCurrentBooking(booking);
    }, [booking]);

    const workStatus = normalizeStatus(currentBooking?.work_status);
    const submitted = isSubmitted(currentBooking?.checklist_submitted);
    const cancelled = workStatus === "CANCELLED";
    const unlocked = workStatus === "UNDER_REVIEW" && !submitted;

    const checklistItems = useMemo(
        () => getServiceChecklist(currentBooking?.services),
        [currentBooking?.services]
    );

    const completedCount = checklistItems.reduce(
        (count, _, index) => count + (checklist[index] ? 1 : 0),
        0
    );

    // Load booking status and saved checklist selections.
    useEffect(() => {
        if (!bookingId) return;

        let active = true;

        const loadState = async () => {
            setLoading(true);
            setError("");
            setChecklist({});

            try {
                const { data: authData, error: authError } =
                    await supabase.auth.getUser();

                if (authError) throw authError;
                if (!authData?.user) throw new Error("Please log in again.");

                const { data: bookingData, error: bookingError } = await supabase
                    .from("bookings")
                    .select("id, user_id, work_status, checklist_submitted, services")
                    .eq("id", bookingId)
                    .eq("user_id", authData.user.id)
                    .single();

                if (bookingError) throw bookingError;
                if (!bookingData) throw new Error("Booking not found.");

                const { data: savedItems, error: itemsError } = await supabase
                    .from("booking_checklists")
                    .select("task_index, customer_completed")
                    .eq("booking_id", bookingId)
                    .order("task_index");

                if (itemsError) throw itemsError;
                if (!active) return;

                setCurrentBooking((previous) => ({
                    ...previous,
                    ...bookingData,
                }));
                onBookingUpdate?.(bookingData);

                const saved = {};
                (savedItems || []).forEach((item) => {
                    saved[item.task_index] = item.customer_completed === true;
                });

                if ((savedItems || []).length > 0) {
                    setChecklist(saved);
                } else if (!isSubmitted(bookingData.checklist_submitted)) {
                    try {
                        const cached = localStorage.getItem(
                            `booking_checklist_${bookingId}`
                        );
                        if (cached) setChecklist(JSON.parse(cached));
                    } catch {
                        // Ignore invalid local cache.
                    }
                }
            } catch (err) {
                if (active) {
                    console.error("Checklist loading failed:", err);
                    setError("Unable to load the checklist. Please refresh and try again.");
                }
            } finally {
                if (active) setLoading(false);
            }
        };

        loadState();

        return () => {
            active = false;
        };
    }, [bookingId, onBookingUpdate]);
    // Listen for partner updates without requiring a page refresh.
    useEffect(() => {
        if (!bookingId) return;

        const channel = supabase
            .channel(`website-checklist-${bookingId}`)
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "bookings",
                    filter: `id=eq.${bookingId}`,
                },
                async () => {
                    const { data: authData } = await supabase.auth.getUser();
                    if (!authData?.user) return;

                    const { data, error: refreshError } = await supabase
                        .from("bookings")
                        .select("id, user_id, work_status, checklist_submitted, services")
                        .eq("id", bookingId)
                        .eq("user_id", authData.user.id)
                        .maybeSingle();

                    if (!refreshError && data) {
                        setCurrentBooking((previous) => ({
                            ...previous,
                            ...data,
                        }));

                        onBookingUpdate?.(data);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [bookingId, onBookingUpdate]);
    const toggleItem = (index) => {
        if (!unlocked || submitting || loading || error) return;

        setChecklist((previous) => {
            const updated = {
                ...previous,
                [index]: !previous[index],
            };

            try {
                localStorage.setItem(
                    `booking_checklist_${bookingId}`,
                    JSON.stringify(updated)
                );
            } catch {
                // Checklist remains usable if browser storage is unavailable.
            }

            return updated;
        });
    };

    const handleSubmit = async () => {
        if (
            !bookingId ||
            !unlocked ||
            loading ||
            submittingRef.current ||
            error
        ) {
            return;
        }

        submittingRef.current = true;
        setSubmitting(true);

        try {
            const { data: authData, error: authError } =
                await supabase.auth.getUser();

            if (authError) throw authError;
            if (!authData?.user) throw new Error("Please log in again.");

            // Recheck status and ownership immediately before submission.
            const { data: latest, error: bookingError } = await supabase
                .from("bookings")
                .select("id, work_status, checklist_submitted, services")
                .eq("id", bookingId)
                .eq("user_id", authData.user.id)
                .single();

            if (bookingError) throw bookingError;

            if (isSubmitted(latest.checklist_submitted)) {
                setCurrentBooking((previous) => ({
                    ...previous,
                    ...latest,
                }));
                toast.info("This checklist has already been submitted.");
                return;
            }

            if (normalizeStatus(latest.work_status) !== "UNDER_REVIEW") {
                setCurrentBooking((previous) => ({
                    ...previous,
                    ...latest,
                }));
                throw new Error("This booking is not ready for checklist submission.");
            }

            const latestItems = getServiceChecklist(latest.services);

            const tasksPayload = latestItems.map((title, index) => ({
                booking_id: bookingId,
                task_index: index,
                task_title: title,
                customer_completed: Boolean(checklist[index]),
            }));

            // Step 1: Save the checklist items.
            const { error: checklistError } = await supabase
                .from("booking_checklists")
                .upsert(tasksPayload, {
                    onConflict: "booking_id,task_index",
                });

            if (checklistError) throw checklistError;

            // Step 2: Mark submitted only after items have been saved.
            const { data: updatedBooking, error: updateError } = await supabase
                .from("bookings")
                .update({ checklist_submitted: true })
                .eq("id", bookingId)
                .eq("user_id", authData.user.id)
                .eq("checklist_submitted", false)
                .ilike("work_status", "UNDER_REVIEW")
                .select("id, work_status, checklist_submitted, services")
                .maybeSingle();

            if (updateError) throw updateError;

            if (!updatedBooking || !isSubmitted(updatedBooking.checklist_submitted)) {
                throw new Error("Checklist submission could not be confirmed.");
            }

            setCurrentBooking((previous) => ({
                ...previous,
                ...updatedBooking,
            }));

            try {
                localStorage.removeItem(`booking_checklist_${bookingId}`);
            } catch {
                // Ignore storage errors.
            }

            toast.success(
                "Checklist submitted successfully! The partner can now complete the booking."
            );

            if (onSuccess) onSuccess(updatedBooking);
        } catch (err) {
            console.error("Checklist submission error:", err);
            toast.error(err.message || "Failed to submit checklist. Please try again.");
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };

    if (!bookingId || cancelled) return null;

    return (
        <section className="service-checklist">
            <div className="service-checklist-header">
                <div>
                    <h3>Service Checklist</h3>
                    <p>Verify the quality of tasks completed by our service partner.</p>
                </div>

                {(unlocked || submitted) && !loading && (
                    <span className="service-checklist-progress">
                        {completedCount} / {checklistItems.length} completed
                    </span>
                )}
            </div>

            {loading ? (
                <div className="service-checklist-message">
                    Loading checklist...
                </div>
            ) : error ? (
                <div className="service-checklist-error" role="alert">
                    {error}
                </div>
            ) : !unlocked && !submitted ? (
                <div className="service-checklist-locked">
                    <span className="service-checklist-lock-icon">🔒</span>
                    <h4>Checklist Locked</h4>
                    <p>
                        The checklist will become available once the service partner
                        finishes the work and moves the booking to UNDER_REVIEW.
                    </p>
                </div>
            ) : (
                <div className="service-checklist-items">
                    {checklistItems.map((title, index) => (
                        <label
                            key={`${bookingId}-${index}`}
                            className={`service-checklist-item ${checklist[index] ? "is-checked" : ""
                                } ${submitted ? "is-submitted" : ""}`}
                        >
                            <input
                                type="checkbox"
                                checked={Boolean(checklist[index])}
                                disabled={submitted || submitting}
                                onChange={() => toggleItem(index)}
                            />
                            <span>{title}</span>
                        </label>
                    ))}

                    <button
                        type="button"
                        className={`service-checklist-submit ${submitted ? "submitted" : ""
                            }`}
                        disabled={submitted || submitting}
                        onClick={handleSubmit}
                    >
                        {submitting
                            ? "Submitting Checklist..."
                            : submitted
                                ? "✓ Checklist Submitted"
                                : "Submit Checklist"}
                    </button>
                </div>
            )}
        </section>
    );
}

import { useLocation, useNavigate } from "react-router-dom";
import { FiArrowLeft, FiX } from "react-icons/fi";
import { Helmet } from "react-helmet-async";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import "./Payment.css";
import { supabase } from "../components/supabaseClient";
import { processPayment } from "../Services/PaymentService";
import Header from "../components/SampleHeader";
import { parseDurationToMinutes, formatDuration } from "../utils/durationUtils";

import { useToast } from "../components/Toast/ToastContext";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const getCurrency = (value) => {
  if (!value) return "₹"; // Fallback
  const match = String(value).match(/^([^\d\s]+)/);
  return match ? match[1] : "₹";
};

const formatPrice = (value) => {
  if (value === 0 || value === "0") return "0";
  if (!value) return "";
  // If it's already a number, just return it
  if (typeof value === "number") return value;
  // If it's a string, strip the currency symbol
  return value.toString().replace(/^[^\d\s]+\s*/, "");
};

const getPlatform = () => {
  try {
    const userAgent = navigator.userAgent || "";
    if (/android/i.test(userAgent)) return "android";
    if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
    return "website";
  } catch (e) {
    return "website"; // fallback
  }
};

const formatTotalAddress = (data, fallbackParts) => {
  if (data.display_name) {
    // Split by comma and clean redundant/administrative noise
    const rawParts = data.display_name.split(",").map(p => p.trim());

    // Deduplicate parts while preserving order
    const uniqueParts = [];
    const seen = new Set();

    for (const p of rawParts) {
      const lowP = p.toLowerCase();
      // Skip if it's a bare Pin code (handled at the end)
      if (/^\d{6}$/.test(p)) continue;

      // Skip redundant or noise markers (like 'mandal', 'ward')
      const noiseMarkers = ["mandal", "ward", "department"];
      if (noiseMarkers.some(m => lowP.includes(m))) continue;

      if (!seen.has(lowP)) {
        uniqueParts.push(p);
        seen.add(lowP);
      }
    }

    const result = uniqueParts.join(", ");
    if (result) return result;
  }
  const fallback = fallbackParts.filter(Boolean).join(", ");
  return fallback || "Pinned Location";
};

export default function Payment({ user }) {
  const location = useLocation();
  const navigate = useNavigate();

  const toast = useToast();

  let { services = [], date, time, month, year } = location.state || {};
  if (typeof services === "string") services = JSON.parse(services);

  const [selectedServices, setSelectedServices] = useState(services || []);
  const [showAddOnDetail, setShowAddOnDetail] = useState(false);
  const [selectedAddOn, setSelectedAddOn] = useState(null);
  const [isFetchingDetail, setIsFetchingDetail] = useState(false);

  /* ================= ADD-ONS STATE ================= */
  const [addOns, setAddOns] = useState([]);
  const [showAddService, setShowAddService] = useState(false);





  const successProcessingRef = useRef(false);

  const fetchAndShowDetail = async (service) => {
    // Open modal immediately with what we have, then enrich with full data
    setSelectedAddOn(service);
    setShowAddOnDetail(true);
    setIsFetchingDetail(true);

    try {
      const table = service.isAddon ? "add_ons" : "services";
      const { data, error } = await supabase
        .from(table)
        .select("description, work_includes, work_not_included, image, duration, service_type")
        .eq("id", service.id)
        .single();

      if (!error && data) {
        setSelectedAddOn((prev) => ({ ...prev, ...data }));
      }
    } catch (e) {
      console.error("Failed to fetch detail:", e);
    } finally {
      setIsFetchingDetail(false);
    }
  };

  const currency = useMemo(() => {
    const firstService = selectedServices[0];
    return getCurrency(firstService?.price || firstService?.original_price);
  }, [selectedServices]);

  const fetchFreshData = useCallback(async () => {
    if (selectedServices.length === 0) return;

    const ids = selectedServices.map((s) => s.id).filter(Boolean);
    if (ids.length === 0) return;

    const { data: servicesData } = await supabase
      .from("services")
      .select("*")
      .in("id", ids);

    const { data: addonsData } = await supabase
      .from("add_ons")
      .select("*")
      .in("id", ids);

    const freshMap = new Map();
    if (servicesData) servicesData.forEach((s) => freshMap.set(s.id, s));
    if (addonsData) addonsData.forEach((s) => freshMap.set(s.id, s));

    const { data: offersData } = await supabase
      .from("offers")
      .select("*")
      .eq("is_offer_enabled", true)
      .order("created_at", { ascending: false });

    const updatedServices = selectedServices.map((s) => {
      const fresh = freshMap.get(s.id);
      if (fresh) {
        // 1. Check for active offer override in DB
        const matchingOffer = (offersData || []).find(o => o.title === fresh.title);

        // 2. Determine base price and discount from various sources
        let finalPrice = fresh.price;
        let finalDiscountPercent = parseFloat(fresh.discount_percent) || 0;
        let finalDiscountLabel = (fresh.discount_label ? fresh.discount_label.toUpperCase() : null) || (finalDiscountPercent > 0 ? `${finalDiscountPercent}% OFF` : null);

        if (matchingOffer) {
          const offerPrice = matchingOffer.offer_price || matchingOffer.fixed_price;
          const offerPct = parseFloat(matchingOffer.offer_percentage) || 0;
          const originalPrice = fresh.original_price ? parseFloat(String(fresh.original_price).replace(/[^\d.]/g, "")) : null;

          if (offerPrice !== undefined && offerPrice !== null) {
            finalPrice = offerPrice;
          } else if (originalPrice && offerPct > 0) {
            finalPrice = Math.round(originalPrice * (1 - offerPct / 100));
          }

          finalDiscountPercent = offerPct;
          finalDiscountLabel = offerPct > 0 ? `${offerPct}% OFF` : "SPECIAL OFFER";
        }

        return {
          ...s,
          ...fresh,
          price: finalPrice,
          discount_percent: finalDiscountPercent,
          discount_label: finalDiscountLabel,
          quantity: s.quantity,
        };
      }
      return s;
    });

    setSelectedServices(updatedServices);
  }, [selectedServices]);

  useEffect(() => {
    fetchFreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run ONCE on mount



  /* ================= FETCH ALL ADD-ONS ================= */
  useEffect(() => {
    supabase
      .from("add_ons")
      .select(
        "id, title, duration, price, original_price, discount_percent, image, work_includes, description, work_not_included, service_type, max_quantity, is_active"
      )
      .eq("is_active", true) // ✅ Only active addons
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        if (data) {
          // Normalize category mapping
          const firstService = selectedServices[0];
          const rawType = (firstService?.service_type || "").toUpperCase();
          let mappedType = rawType.replace(/_/g, " ").trim();

          // Core mappings to match database strings
          if (mappedType === "ADDITIONAL") mappedType = "ADDITIONAL SERVICES";
          if (mappedType === "KITCHEN CLEANING") mappedType = "KITCHEN";
          if (mappedType === "FULL HOME DEEP CLEANING")
            mappedType = "DEEP CLEANING";

          // Filter addons to match the main service's mapped type (case-insensitive)
          const filtered = data.filter(
            (addon) =>
              (addon.service_type || "").toUpperCase().trim() === mappedType
          );

          setAddOns(filtered);
        }
      });
  }, [selectedServices]);

  /* ================= QUANTITY LOGIC ================= */
  const addService = (svc) => {
    const existing = selectedServices.find((s) => s.id === svc.id);
    if (existing) {
      const limit = existing.max_quantity || 3; // Default 3
      if (existing.quantity >= limit) {
        toast.error(`You can only add up to ${limit} of this service.`);
        return;
      }

      setSelectedServices((prev) =>
        prev.map((s) =>
          s.id === svc.id ? { ...s, quantity: (s.quantity || 1) + 1 } : s
        )
      );
      return;
    }

    // New service addition
    const originalPrice = svc.original_price
      ? parseFloat(String(svc.original_price).replace(/[^\d.]/g, ""))
      : null;
    const discountPercent = parseFloat(svc.discount_percent) || 0;
    const calculatedPrice =
      originalPrice && discountPercent > 0
        ? Math.round(originalPrice * (1 - discountPercent / 100))
        : svc.price;

    setSelectedServices((prev) => [
      ...prev,
      {
        ...svc,
        price: calculatedPrice,
        original_price: originalPrice,
        quantity: 1,
        isAddon: true,
      },
    ]);
  };

  const removeService = (id) => {
    setSelectedServices((prev) => {
      const existing = prev.find((s) => s.id === id);
      if (existing && existing.quantity > 1) {
        return prev.map((s) =>
          s.id === id ? { ...s, quantity: s.quantity - 1 } : s
        );
      }
      return prev.filter((s) => s.id !== id);
    });
  };


  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [address, setAddress] = useState(location.state?.address || "");
  const [city, setCity] = useState("Hyderabad");
  const [zip, setZip] = useState(location.state?.pincode || "");
  const [message, setMessage] = useState("");

  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [isAddressSummaryMode, setIsAddressSummaryMode] = useState(false);
  const [hasUsedLocationFetch, setHasUsedLocationFetch] = useState(false);
  const [isCheckingPincode, setIsCheckingPincode] = useState(false);

  const [showPincodeAlert, setShowPincodeAlert] = useState(false);
  const [showPaymentFailAlert, setShowPaymentFailAlert] = useState(false);
  const [showSuccessAlert, setShowSuccessAlert] = useState(false);
  const [pendingBookingData, setPendingBookingData] = useState(null);
  const [criticalError, setCriticalError] = useState(null);

  const [acceptPolicies, setAcceptPolicies] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);

  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalContent, setModalContent] = useState("");
  const [loadingPolicy, setLoadingPolicy] = useState(false);

  const [isPaying, setIsPaying] = useState(false);
  const lockRef = useRef(false);
  const [paymentErrorMsg, setPaymentErrorMsg] = useState("");

  const [walletBalance, setWalletBalance] = useState(0);
  const [useWallet, setUseWallet] = useState(false);

  const [isPincodeServiceable, setIsPincodeServiceable] = useState(true);
  const lastGeocodeRequestId = useRef(0);
  const toastRef = useRef(toast);

  // Keep toastRef updated but don't use it as a dependency for hooks
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);



  const finalizeLocation = useCallback(async (position, requestId, isBg) => {
    const { latitude: lat, longitude: lng } = position.coords;

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=en&zoom=18`,
        {
          headers: { "Accept-Language": "en-US,en" }
        }
      );
      if (requestId !== lastGeocodeRequestId.current) return;
      const data = await response.json();

      if (data && data.address) {
        const addr = data.address;
        const fetchedZip = addr.postcode || "";
        const fetchedCity = addr.city || addr.town || addr.village || addr.county || "";
        const parts = [];

        if (addr.amenity) parts.push(addr.amenity);
        if (addr.office) parts.push(addr.office);
        if (addr.shop) parts.push(addr.shop);
        if (addr.tourism) parts.push(addr.tourism);
        if (addr.leisure) parts.push(addr.leisure);
        if (addr.building) parts.push(addr.building);
        if (addr.house_number) parts.push(addr.house_number);
        if (addr.road) parts.push(addr.road);
        if (addr.neighbourhood) parts.push(addr.neighbourhood);
        if (addr.residential) parts.push(addr.residential);
        if (addr.suburb) parts.push(addr.suburb);
        if (addr.city_district) parts.push(addr.city_district);
        if (fetchedCity) parts.push(fetchedCity);

        // Geocoding fallback
        let fetchedAddress = formatTotalAddress(data, parts);

        let finalZip = fetchedZip;
        const isPragathiNagar = fetchedAddress?.toLowerCase().includes("pragathi nagar") ||
          (data.display_name && data.display_name.toLowerCase().includes("pragathi nagar"));

        if (isPragathiNagar && (fetchedZip === "501002" || !fetchedZip)) {
          finalZip = "500090";
        }

        let finalAddress = fetchedAddress;
        if ((finalZip === "500090" || finalZip === "501002") && !finalAddress.toLowerCase().includes("hyderabad")) {
          finalAddress += ", Hyderabad";
        }

        // Prevent zip/pincode doubling: check if address already ends with the zip
        const displayAddress = (finalZip && !finalAddress.includes(finalZip))
          ? `${finalAddress} - ${finalZip}`
          : finalAddress;

        // Background fetch vs User click
        if (isBg) {
          setAddress(prev => prev || displayAddress);
          if (fetchedCity) setCity(prev => prev || fetchedCity);
          if (finalZip) setZip(prev => prev || finalZip);
        } else {
          setAddress(displayAddress);
          if (fetchedCity) setCity(fetchedCity);
          if (finalZip) setZip(finalZip);
          setHasUsedLocationFetch(true);
          setIsAddressSummaryMode(true);
        }
      }
    } catch (error) {
      console.error("Geocoding error:", error);
    }
  }, []);

  const fetchCurrentLocation = useCallback((isBackground = false) => {
    const isBg = isBackground === true;
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude: lat, longitude: lng } = position.coords;

        setLatitude(prev => (!prev || !isBg) ? lat : prev);
        setLongitude(prev => (!prev || !isBg) ? lng : prev);

        finalizeLocation(position, ++lastGeocodeRequestId.current, isBg);
      },
      (error) => {
        console.warn("Geolocation error:", error);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );
  }, [finalizeLocation]);

  // Coupon State
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [isVerifyingCoupon, setIsVerifyingCoupon] = useState(false);
  const [couponStatus, setCouponStatus] = useState({ type: "", message: "" });

  const fetchPolicy = async (columnName, title) => {
    setModalTitle(title);
    setPolicyModalOpen(true);
    setLoadingPolicy(true);
    setModalContent("");

    try {
      const { data, error } = await supabase
        .from("app_policies")
        .select(columnName)
        .limit(1)
        .single();

      if (error) throw error;
      setModalContent(data?.[columnName] || "No content available.");
    } catch (err) {
      setModalContent(`Failed to load content. Error: ${err.message}`);
    } finally {
      setLoadingPolicy(false);
    }
  };

  const [profileServiceSelected, setProfileServiceSelected] = useState(null);
  const [profileBannerSelected, setProfileBannerSelected] = useState(null);

  const initDone = useRef(false);
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;

    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Even if no user, try to get background location for map biasing
        fetchCurrentLocation(true);
        return;
      }

      const { data } = await supabase
        .from("profile")
        .select("full_name,email,phone,address,pincode,service_selected,promotional_banner_selected")
        .eq("id", user.id)
        .single();

      if (data) {
        setFirstName(data.full_name || "");
        setEmail(data.email || user.email || "");
        setProfileServiceSelected(data.service_selected || null);
        setProfileBannerSelected(data.promotional_banner_selected || null);

        // Auto-apply promotional banner coupon ONLY IF the user originated from the promotional flow
        try {
          const stored = sessionStorage.getItem("claimedOffer");
          let appliedFromSession = false;

          if (stored) {
            const claimedOffer = JSON.parse(stored);

            // Validate that this claimed offer belongs to the CURRENT user
            // and that it actually came from the promotional banner
            if (claimedOffer && claimedOffer.userId === user.id) {
              const isPromotionalSource =
                claimedOffer.source === "promotional_banner" ||
                claimedOffer.type === "PROMOTIONAL_BANNER" ||
                claimedOffer.type === "NEW_USER";

              if (isPromotionalSource) {
                appliedFromSession = true;
                setAppliedCoupon(prev => {
                  if (!prev) {
                    return {
                      coupon_code: `BANNER${claimedOffer.offerPercentage}`,
                      discount_percentage: claimedOffer.offerPercentage,
                      discount_amount: null,
                      bannerId: claimedOffer.bannerId,
                      source: "promotional_banner",
                    };
                  }
                  return prev;
                });
                setCouponStatus(prev => {
                  if (!prev || !prev.message) {
                    return { type: "success", message: `Coupon auto-applied! ${claimedOffer.offerPercentage}% discount` };
                  }
                  return prev;
                });
              }
            } else if (claimedOffer && claimedOffer.userId !== user.id) {
              // Clear stale session storage from another user
              sessionStorage.removeItem("claimedOffer");
            }
          }

          // Fallback: If session storage was lost (common on iOS/mobile browsers),
          // recover the selected promotional banner directly from the user's database profile!
          if (!appliedFromSession && data.promotional_banner_selected) {
            const { data: bannerData } = await supabase
              .from("promotional_banners")
              .select("id, offer_percentage")
              .eq("id", data.promotional_banner_selected)
              .single();

            if (bannerData) {
              setAppliedCoupon(prev => {
                if (!prev) {
                  return {
                    coupon_code: `BANNER${bannerData.offer_percentage}`,
                    discount_percentage: bannerData.offer_percentage,
                    discount_amount: null,
                    bannerId: bannerData.id,
                    source: "promotional_banner",
                  };
                }
                return prev;
              });
              setCouponStatus(prev => {
                if (!prev || !prev.message) {
                  return { type: "success", message: `Coupon auto-applied! ${bannerData.offer_percentage}% discount` };
                }
                return prev;
              });
            }
          }
        } catch (e) {
          console.error("Error parsing claimedOffer:", e);
        }

        const rawPhone = data.phone || "";
        const cleanPhone = rawPhone.replace(/\D/g, "");
        const displayPhone = cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone;

        setPhone(displayPhone);
        setProfilePhone(data.phone || "");

        if (location.state?.address) {
          setAddress(location.state.address);
        } else if (data.address) {
          setAddress(data.address);
        }

        if (location.state?.pincode) {
          setZip(location.state.pincode);
        } else if (data.pincode) {
          setZip(data.pincode);
        }

        if (data.address) {
          setIsAddressSummaryMode(true);
          setHasUsedLocationFetch(true);

          // Background Geocoding of existing address to get coordinates for MapPicker default
          try {
            const query = data.address.includes(",") ? data.address : `${data.address}, Hyderabad`;
            const geocodeRes = await fetch(
              `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&accept-language=en`
            );
            const geocodeData = await geocodeRes.json();
            if (geocodeData && geocodeData.length > 0) {
              setLatitude(parseFloat(geocodeData[0].lat));
              setLongitude(parseFloat(geocodeData[0].lon));
            }
          } catch (e) {
            console.warn("Background geocoding failed:", e);
          }
        }
      }

      // Fetch wallet balance
      const { data: walletData } = await supabase
        .from("wallet")
        .select("balance")
        .eq("user_id", user.id)
        .maybeSingle();

      if (walletData) {
        setWalletBalance(walletData.balance || 0);
      }

      // Also trigger a background GPS fetch if we don't have coords yet
      fetchCurrentLocation(true);
    };
    init();
  }, [fetchCurrentLocation, location.state]);

  // Pincode & Hub Category serviceable check
  useEffect(() => {
    const checkPincode = async () => {
      const cleanPin = (zip || "").trim();
      if (!cleanPin || cleanPin.length !== 6) {
        setIsPincodeServiceable(false);
        return;
      }

      setIsCheckingPincode(true);
      try {
        const { data: hubData } = await supabase
          .from("hub_locations")
          .select("id, hub_name")
          .eq("pincode", cleanPin)
          .limit(1);

        if (hubData && hubData.length > 0) {
          const hubName = hubData[0].hub_name;

          if (selectedServices && selectedServices.length > 0) {
            const firstService = selectedServices[0];
            const rawType = (firstService?.service_type || "").toUpperCase().trim();
            const spaceType = rawType.replace(/_/g, " ").trim();
            const underscoreType = rawType.replace(/\s+/g, "_").trim();

            const { data: catRows } = await supabase
              .from("hub_category_counts")
              .select("count, category")
              .ilike("hub", hubName);

            if (catRows && catRows.length > 0) {
              const match = catRows.find((r) => {
                const cat = (r.category || "").toUpperCase().trim();
                return cat === rawType || cat === spaceType || cat === underscoreType;
              });

              if (!match || Number(match.count) <= 0) {
                setIsPincodeServiceable(false);
                return;
              }
            } else {
              setIsPincodeServiceable(false);
              return;
            }
          }

          setIsPincodeServiceable(true);
          return;
        }

        const { data: areaData } = await supabase
          .from("neatify_service_areas")
          .select("id")
          .eq("pincode", cleanPin)
          .limit(1);

        setIsPincodeServiceable(!!(areaData && areaData.length > 0));
      } catch (err) {
        console.error("Pincode check error:", err);
        setIsPincodeServiceable(false);
      } finally {
        setIsCheckingPincode(false);
      }
    };

    checkPincode();
  }, [zip, selectedServices]);

  // Clear coupon if phone number doesn't match profile or is cleared (only for manual non-banner coupons)
  useEffect(() => {
    if (profilePhone && appliedCoupon && !appliedCoupon.bannerId) {
      const cleanPhone = phone.replace(/\D/g, "").slice(-10);
      const cleanProfilePhone = profilePhone.replace(/\D/g, "").slice(-10);

      if (!cleanPhone || cleanPhone !== cleanProfilePhone) {
        setAppliedCoupon(null);
        setCouponInput("");
        setCouponStatus({ type: "", message: "" });
      }
    }
  }, [phone, profilePhone, appliedCoupon]);

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    // Keep couponInput as is (don't clear)
    setCouponStatus({ type: "", message: "Coupon disabled" });
  };

  const handleApplyCoupon = async () => {
    if (!couponInput.trim()) {
      setCouponStatus({ type: "error", message: "Please enter a coupon code" });
      return;
    }

    if (!phone) {
      setCouponStatus({ type: "error", message: "Please enter your phone number first" });
      return;
    }

    setIsVerifyingCoupon(true);
    setCouponStatus({ type: "", message: "" });

    try {
      const cleanPhone = phone.replace(/\D/g, "").slice(-10);

      const input = couponInput.trim();
      let query = supabase.from("coupons").select("*").eq("coupon_code", input).maybeSingle();

      const { data, error } = await query;

      if (error || !data) {
        setCouponStatus({ type: "error", message: "Invalid coupon code" });
        setAppliedCoupon(null);
      } else if (data.is_used) {
        setCouponStatus({ type: "error", message: "This coupon has already been used" });
        setAppliedCoupon(null);
      } else if (data.is_active === false) {
        setCouponStatus({ type: "error", message: "This coupon is currently inactive" });
        setAppliedCoupon(null);
      } else {
        const couponPhone = data.phone_number ? data.phone_number.replace(/\D/g, "").slice(-10) : "";
        if (couponPhone && couponPhone !== cleanPhone) {
          setCouponStatus({ type: "error", message: "This coupon is not valid for your phone number" });
          setAppliedCoupon(null);
        }

        {
          // Verify service restriction if coupon specifies a service_id or service_ids
          let allowedServiceIds = null;
          if (data.service_ids) {
            if (Array.isArray(data.service_ids)) {
              allowedServiceIds = data.service_ids;
            } else {
              try {
                allowedServiceIds = typeof data.service_ids === 'string'
                  ? JSON.parse(data.service_ids)
                  : data.service_ids;
              } catch (e) {
                allowedServiceIds = String(data.service_ids).split(',').map(id => id.trim());
              }
            }
          }

          const hasValidService = selectedServices.some(s => {
            const serviceIdStr = String(s.id || s.service_id || '');
            if (data.service_id && String(data.service_id) === serviceIdStr) return true;
            if (allowedServiceIds && allowedServiceIds.some(allowedId => String(allowedId) === serviceIdStr)) return true;
            return false;
          });

          const hasRestriction = data.service_id || (allowedServiceIds && allowedServiceIds.length > 0);

          if (hasRestriction && !hasValidService) {
            setCouponStatus({ type: "error", message: "This coupon is not valid for the selected services" });
            setAppliedCoupon(null);
          } else {
            const normalizedData = {
              ...data,
              discount_percentage: data.discount_percentage || data.discount_p || 0,
              discount_amount: data.discount_amount || 0
            };

            setAppliedCoupon(normalizedData);
            const isFixedDiscount = normalizedData.discount_amount && normalizedData.discount_amount > 0;
            setCouponStatus({ type: "success", message: `Coupon applied! ${isFixedDiscount ? `₹${normalizedData.discount_amount}` : `${normalizedData.discount_percentage}%`} discount` });
          }
        }
      }
    } catch (err) {
      console.error("Coupon error:", err);
      setCouponStatus({ type: "error", message: "Error verifying coupon. Try again." });
    } finally {
      setIsVerifyingCoupon(false);
    }
  };

  /* ================= FETCH TAXES ================= */
  const [globalTaxRate, setGlobalTaxRate] = useState(0);

  useEffect(() => {
    const fetchTaxes = async () => {
      try {
        const { data, error } = await supabase
          .from("taxes")
          .select("percent")
          .eq("is_active", true);

        if (error) {
          console.error("Error fetching taxes:", error);
          return;
        }

        if (data && data.length > 0) {
          const totalPercent = data.reduce((sum, row) => {
            const val = parseFloat(row.percent);
            return sum + (isNaN(val) ? 0 : val);
          }, 0);
          setGlobalTaxRate(totalPercent);
        }
      } catch (err) {
        console.error("Tax fetch exception:", err);
      }
    };
    fetchTaxes();
  }, []);

  // Helper to safely parse price strings like "₹ 499.00" or numbers
  const parsePrice = (price) => {
    if (!price) return 0;
    const clean = String(price).replace(/[^\d.]/g, ""); // Keep digits and dot
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  };

  const totalAmount = useMemo(() => {
    const isPromotionalCoupon =
      appliedCoupon?.bannerId ||
      appliedCoupon?.promotional_banner_id ||
      appliedCoupon?.source === "promotional_banner";

    return selectedServices.reduce((sum, s) => {
      let priceToUse = parsePrice(s.price);

      if (isPromotionalCoupon) {
        const serviceIdStr = String(s.id || s.service_id || '');
        const sName = String(s.title || s.name || "").trim().toLowerCase();
        const pName = String(profileServiceSelected || "").trim().toLowerCase();
        let targetServiceId = null;

        try {
          const stored = sessionStorage.getItem("claimedOffer");
          if (stored) {
            const claimedOffer = JSON.parse(stored);
            const belongsToCurrentUser = claimedOffer.userId && user?.id && claimedOffer.userId === user.id;
            if (belongsToCurrentUser && claimedOffer.serviceId) {
              targetServiceId = String(claimedOffer.serviceId);
            }
          }
        } catch (e) { }

        const isSelectedPromotionalService = (pName && sName && pName === sName) || (targetServiceId && serviceIdStr === targetServiceId);

        const isSelectedPromotionalBanner =
          (profileBannerSelected && appliedCoupon.bannerId)
            ? profileBannerSelected === appliedCoupon.bannerId
            : true;

        if (isSelectedPromotionalService && isSelectedPromotionalBanner) {
          priceToUse = s.original_price ? parsePrice(s.original_price) : priceToUse;
        }
      }

      return sum + priceToUse;
    }, 0);
  }, [selectedServices, appliedCoupon, profileServiceSelected, profileBannerSelected, user]);

  const totalOriginalAmount = useMemo(() => {
    return selectedServices.reduce((sum, s) => {
      return sum + parsePrice(s.original_price);
    }, 0);
  }, [selectedServices]);

  const totalDurationMins = useMemo(() => {
    return selectedServices.reduce((sum, s) => {
      return sum + (parseDurationToMinutes(s.duration) * (s.quantity || 1));
    }, 0);
  }, [selectedServices]);

  const totalTax = useMemo(() => {
    // Use Global Tax fetched from 'taxes' table in Supabase
    if (globalTaxRate > 0) {
      return (totalAmount * globalTaxRate) / 100;
    }
    // Fallback: per-service 'tax_percent' column
    return selectedServices.reduce((sum, s) => {
      const price = parsePrice(s.price);
      const taxRate = parseFloat(s.tax_percent) || 0;
      return sum + (price * taxRate) / 100;
    }, 0);
  }, [selectedServices, totalAmount, globalTaxRate]);

  const finalSubtotal = totalAmount;
  const effectivelyAppliedCoupon = useMemo(() => {
    if (!appliedCoupon) return null;

    const isPromotionalCoupon =
      appliedCoupon.bannerId ||
      appliedCoupon.promotional_banner_id ||
      appliedCoupon.source === "promotional_banner";

    if (!isPromotionalCoupon) return appliedCoupon;

    const pName = String(profileServiceSelected || "").trim().toLowerCase();

    let targetServiceId = null;
    try {
      const stored = sessionStorage.getItem("claimedOffer");
      if (stored) {
        const claimedOffer = JSON.parse(stored);
        const belongsToCurrentUser = claimedOffer.userId && user?.id && claimedOffer.userId === user.id;
        if (belongsToCurrentUser && claimedOffer.serviceId) {
          targetServiceId = String(claimedOffer.serviceId);
        }
      }
    } catch (e) { }

    const hasPromotionalServiceInCart = selectedServices.some(s => {
      const sName = String(s.title || s.name || "").trim().toLowerCase();
      const serviceIdStr = String(s.id || s.service_id || "");

      const isNameMatch = pName && sName && pName === sName;
      const isIdMatch = targetServiceId && serviceIdStr === targetServiceId;

      return isNameMatch || isIdMatch;
    });

    return hasPromotionalServiceInCart ? appliedCoupon : null;
  }, [appliedCoupon, selectedServices, profileServiceSelected, user]);

  const servicesWithPromotions = useMemo(() => {
    // 2. IDENTIFY PROMOTIONAL COUPON
    const isPromotionalCoupon =
      effectivelyAppliedCoupon?.bannerId ||
      effectivelyAppliedCoupon?.promotional_banner_id ||
      effectivelyAppliedCoupon?.source === "promotional_banner";

    return selectedServices.map(s => {
      const serviceIdStr = String(s.id || s.service_id || '');
      const currentPrice = parsePrice(s.price);
      const quantity = s.quantity || 1;

      let promoDiscountPerUnit = 0;
      let displayOriginal = currentPrice;
      let displayFinal = currentPrice;

      if (isPromotionalCoupon) {
        // 4. CHECK SERVICE MATCH (Robust against case and whitespace)
        const sName = String(s.title || s.name || "").trim().toLowerCase();
        const pName = String(profileServiceSelected || "").trim().toLowerCase();
        const isSelectedPromotionalService = pName && sName && pName === sName;

        // 3. CHECK BANNER MATCH (Robust)
        const isSelectedPromotionalBanner =
          (profileBannerSelected && effectivelyAppliedCoupon.bannerId)
            ? profileBannerSelected === effectivelyAppliedCoupon.bannerId
            : true; // Don't fail if effectivelyAppliedCoupon is missing bannerId but isPromotionalCoupon is true

        // Use session storage fallback
        let useSessionFallback = false;
        try {
          const stored = sessionStorage.getItem("claimedOffer");
          if (stored) {
            const claimedOffer = JSON.parse(stored);
            const isPromotionalSource =
              claimedOffer.source === "promotional_banner" ||
              claimedOffer.type === "PROMOTIONAL_BANNER" ||
              claimedOffer.type === "NEW_USER";
            const belongsToCurrentUser = claimedOffer.userId && user?.id && claimedOffer.userId === user.id;

            if (belongsToCurrentUser && claimedOffer && claimedOffer.serviceId && String(claimedOffer.serviceId) === serviceIdStr && isPromotionalSource) {
              useSessionFallback = true;
            }
          }
        } catch (e) { }

        // 6. servicesWithPromotions
        const shouldApplyPromotionalDiscount = (isSelectedPromotionalService && isSelectedPromotionalBanner) || useSessionFallback;

        if (shouldApplyPromotionalDiscount && effectivelyAppliedCoupon) {
          const baseOriginalPrice = s.original_price ? parsePrice(s.original_price) : currentPrice;
          promoDiscountPerUnit = (baseOriginalPrice * parseFloat(effectivelyAppliedCoupon.discount_percentage)) / 100;
          displayOriginal = baseOriginalPrice;
          displayFinal = baseOriginalPrice - promoDiscountPerUnit;
        }
      }

      return {
        ...s,
        promoDiscountPerUnit,
        totalPromoDiscount: promoDiscountPerUnit * quantity,
        displayOriginalPrice: displayOriginal,
        displayFinalPrice: displayFinal,
      };
    });
  }, [selectedServices, effectivelyAppliedCoupon, profileServiceSelected, profileBannerSelected, user]);

  const couponDiscount = useMemo(() => {
    if (!effectivelyAppliedCoupon) return 0;

    // 2. IDENTIFY PROMOTIONAL COUPON
    const isPromotionalCoupon =
      effectivelyAppliedCoupon?.bannerId ||
      effectivelyAppliedCoupon?.promotional_banner_id ||
      effectivelyAppliedCoupon?.source === "promotional_banner";

    if (isPromotionalCoupon) {
      // 7. couponDiscount
      // For a promotional banner coupon, MUST come ONLY from the service-level calculation
      return servicesWithPromotions.reduce((sum, s) => sum + s.totalPromoDiscount, 0);
    }

    // --- NORMAL COUPON LOGIC (Fallback for non-promotional coupons) ---
    let allowedServiceIds = null;
    if (effectivelyAppliedCoupon.service_ids) {
      if (Array.isArray(effectivelyAppliedCoupon.service_ids)) {
        allowedServiceIds = effectivelyAppliedCoupon.service_ids;
      } else {
        try {
          allowedServiceIds = typeof effectivelyAppliedCoupon.service_ids === 'string'
            ? JSON.parse(effectivelyAppliedCoupon.service_ids)
            : effectivelyAppliedCoupon.service_ids;
        } catch (e) {
          allowedServiceIds = String(effectivelyAppliedCoupon.service_ids).split(',').map(id => id.trim());
        }
      }
    }

    const eligibleServices = selectedServices.filter(s => {
      const serviceIdStr = String(s.id || s.service_id || '');
      if (effectivelyAppliedCoupon.service_id && String(effectivelyAppliedCoupon.service_id) !== serviceIdStr) {
        return false;
      }
      if (allowedServiceIds && allowedServiceIds.length > 0) {
        return allowedServiceIds.some(allowedId => String(allowedId) === serviceIdStr);
      }
      return true;
    });

    const eligibleSubtotal = eligibleServices.reduce((sum, s) => {
      return sum + (parsePrice(s.price) * (s.quantity || 1));
    }, 0);

    if (effectivelyAppliedCoupon.discount_amount && effectivelyAppliedCoupon.discount_amount > 0) {
      return Math.min(parseFloat(effectivelyAppliedCoupon.discount_amount), eligibleSubtotal);
    }

    const pct = parseFloat(effectivelyAppliedCoupon.discount_percentage) || 0;
    return (eligibleSubtotal * pct) / 100;
  }, [effectivelyAppliedCoupon, servicesWithPromotions, selectedServices]);

  const totalAmountAfterCoupon = finalSubtotal - couponDiscount;
  const finalTotalAmountBeforeWallet = totalAmountAfterCoupon + totalTax;

  const walletDeduction = useMemo(() => {
    if (!useWallet || walletBalance <= 0) return 0;
    return Math.min(finalTotalAmountBeforeWallet, walletBalance);
  }, [useWallet, walletBalance, finalTotalAmountBeforeWallet]);

  const finalTotalAmount = finalTotalAmountBeforeWallet - walletDeduction;

  /* ================= PAYMENT + BOOKING ================= */

  const handlePlaceOrderAndPay = async () => {
    if (lockRef.current) return;
    lockRef.current = true;
    if (!firstName || !email || !phone || !address || !zip) {
      const missing = [];
      if (!firstName) missing.push("First Name");
      if (!email) missing.push("Email");
      if (!phone) missing.push("Phone");
      if (!address) missing.push("Address");
      if (!zip) missing.push("Pincode");

      toast.warning(`Please fill all required fields: ${missing.join(", ")}`);
      lockRef.current = false;
      return;
    }

    if (phone.replace(/\D/g, "").length !== 10) {
      toast.warning("Phone number must be exactly 10 digits.");
      lockRef.current = false;
      return;
    }

    if (!isPincodeServiceable) {
      toast.error("Service Unavailable: Service is not available in your area yet. We are expanding soon!");
      lockRef.current = false;
      return;
    }

    if (!acceptPolicies || !agreeTerms) {
      toast.warning(
        "Please accept the User Policies & Terms & Conditions to proceed.",
      );
      lockRef.current = false;
      return;
    }

    if (isPaying) {
      lockRef.current = false;
      return;
    }
    setIsPaying(true);

    try {
      // ✅ AUTH CHECK (Moved to top)
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const platform = getPlatform();
      if (!user) {
        setIsPaying(false);
        lockRef.current = false;
        toast.error("Please login to proceed.");
        return;
      }

      /* ✅ BACKWARD SYNC (ALWAYS UPDATE FIRST) */

      const cleanPhone = phone.replace(/\D/g, "").slice(-10);
      const formattedPhone = `+91${cleanPhone}`;

      await supabase
        .from("profile")
        .update({
          full_name: firstName,
          phone: formattedPhone,
          address: address,
          pincode: zip,
          email: email,
        })
        .eq("id", user.id);

      await supabase
        .from("signup")
        .update({
          full_name: firstName,
          phone: formattedPhone,
          email: email,
        })
        .eq("id", user.id);

      await supabase.auth.updateUser({
        data: {
          display_name: firstName,
          full_name: firstName,
          phone_number: formattedPhone,
        },
      });

      /* 1️⃣ PINCODE CHECK */
      const { data: hubCheck } = await supabase
        .from("hub_locations")
        .select("id")
        .eq("pincode", zip.trim())
        .limit(1);

      const { data: areaCheck } = await supabase
        .from("neatify_service_areas")
        .select("id")
        .eq("pincode", zip.trim())
        .limit(1);

      if ((!hubCheck || hubCheck.length === 0) && (!areaCheck || areaCheck.length === 0)) {
        setIsPaying(false);
        lockRef.current = false;
        setShowPincodeAlert(true);
        return;
      }

      /* 2️⃣ CREATE PENDING BOOKING */
      let formattedDate = "";
      if (year && month !== undefined && date) {
        formattedDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
      } else {
        formattedDate = new Date().toISOString().split("T")[0];
      }
      const bookingData = {
        user_id: user.id,
        customer_name: firstName,
        email: email,
        phone_number: formattedPhone,
        full_address: `${address}${city ? ', ' + city : ''}, ${zip}`,
        latitude: latitude || 17.3850, // Default to Hyderabad
        longitude: longitude || 78.4867,
        services: selectedServices,
        booking_date: formattedDate,
        booking_time: time || "Not specified",
        booking_schedule_at: `${formattedDate} ${time || "00:00:00"} +05:30`,
        total_amount: Number(finalTotalAmount.toFixed(2)),
        payment_status: "pending",
        payment_verified: false,
        payment_method: "razorpay",
        work_status: "PENDING",

        // ✅ NEW LINE ADDED
        platform: platform,

        coupon_code: appliedCoupon ? appliedCoupon.coupon_code : null,
        coupon_discount_percentage: appliedCoupon ? appliedCoupon.discount_percentage : 0,
        coupon_discount_amount: Number(couponDiscount.toFixed(2)),
        promotional_banner_id: appliedCoupon?.bannerId || null,
      };

      const { data: bookingRow, error: bookingError } = await supabase
        .from("bookings")
        .insert([bookingData])
        .select()
        .single();

      if (bookingError || !bookingRow) {
        setIsPaying(false);
        lockRef.current = false;
        console.error("Booking creation failed:", bookingError);
        // Show actual error message to help identify missing columns like 'platform'
        const errorMsg = bookingError.message?.toLowerCase().includes("platform")
          ? "Database Column Missing: 'platform' column is missing in Supabase. Please add it to your bookings table."
          : `Failed to create booking: ${bookingError.message || "Unknown error"}`;
        toast.error(errorMsg);
        return;
      }

      const bookingId = bookingRow.id;

      /* 3️⃣ PROCESS PAYMENT */
      const paymentResult = await processPayment(finalTotalAmount, {
        firstName,
        lastName: "",
        email,
        phone: formattedPhone,
      }, bookingId);

      if (!paymentResult.success) {
        setIsPaying(false);
        // Update booking to failed
        await supabase
          .from("bookings")
          .update({
            payment_status: "failed",
            work_status: "FAILED"
          })
          .eq("id", bookingId);

        if (paymentResult.error !== "DISMISSED") {
          setPaymentErrorMsg(paymentResult.error || "Unknown Error");
          setShowPaymentFailAlert(true);
        } else {
          // If the user just dismissed the Razorpay modal, still show them their bookings
          navigate("/my-bookings");
        }
        lockRef.current = false;
        return;
      }

      /* 4️⃣ SUCCESS - Fire booking confirmation email (fire-and-forget) */
      supabase.functions.invoke("send-booking-confirmation", {
        body: { booking_id: bookingId },
      }).then(({ error }) => {
        if (error) console.error("❌ send-booking-confirmation failed:", error.message);
        else console.log("✅ Booking confirmation email triggered for:", bookingId);
      });

      /* Store payment data temporarily (will be used when user clicks OK) */
      setPendingBookingData({
        bookingId,
        paymentResult,
        appliedCoupon,
        couponDiscount
      });

      // ✅ Deduct from wallet if used
      if (useWallet && walletDeduction > 0) {
        const { error: walletError } = await supabase
          .from("wallet")
          .update({ balance: walletBalance - walletDeduction })
          .eq("user_id", user.id);

        if (!walletError) {
          await supabase.from("wallet_transactions").insert({
            user_id: user.id,
            amount: -walletDeduction,
            transaction_type: "booking_payment",
            description: `Used wallet balance for booking #${bookingId}`
          });
        }
      }

      // ✅ Show success alert - user will click OK to confirm and save
      setShowSuccessAlert(true);

    } catch (err) {
      console.error("Order flow error:", err);
      setShowPaymentFailAlert(true);
    } finally {
      setIsPaying(false);
      lockRef.current = false;
    }
  };

  /* ================= UI ================= */

  return (
    <>
      <Helmet>
        <title>Payment | The Neatify Team | Cleaning Services in Hyderabad</title>
        <link rel="canonical" href="https://www.theneatifyteam.in/payment" />
      </Helmet>
      <Header user={user} />

      {isPaying && (
        <div style={overlayStyle}>
          <div
            style={{
              background: "#fff",
              padding: "24px 30px",
              borderRadius: "12px",
              fontWeight: "bold",
            }}
          >
            Processing Payment...
          </div>
        </div>
      )}

      {showPincodeAlert && (
        <Modal
          title="Service Unavailable"
          text="Service is not available in your area yet. We are expanding soon!"
          onClose={() => setShowPincodeAlert(false)}
        />
      )}

      {showPaymentFailAlert && (
        <Modal
          title="Payment Failed"
          text={paymentErrorMsg || "Payment was not successful. Please try again."}
          onClose={() => {
            setShowPaymentFailAlert(false);
            navigate("/my-bookings");
          }}
        />
      )}

      {criticalError && (
        <Modal
          title="⚠️ Booking Error"
          text={`PAYMENT SUCCESSFUL, BUT BOOKING FAILED. \n\nPayment ID: ${criticalError.paymentId} \n\nPlease take a screenshot and contact support immediately.`}
          onClose={() => setCriticalError(null)}
          isCritical={true}
        />
      )}

      {showSuccessAlert && (
        <Modal
          title="Booking Successful!"
          text="Your booking has been placed and payment verified. You can view it in My Bookings."
          onClose={async () => {
            if (successProcessingRef.current) return;
            successProcessingRef.current = true;

            console.log("✅ Success modal closed, pendingBookingData:", pendingBookingData);
            setShowSuccessAlert(false); // Hide immediately to prevent double clicks

            if (pendingBookingData) {
              const { appliedCoupon } = pendingBookingData;

              try {
                // Mark coupon as used and clear session states
                sessionStorage.removeItem("claimedOffer");
                sessionStorage.removeItem("newUserOffer");

                if (appliedCoupon) {
                  let query = supabase.from("coupons").update({ is_used: true });
                  if (appliedCoupon.id) {
                    query = query.eq("id", appliedCoupon.id);
                  } else {
                    query = query.eq("coupon_code", appliedCoupon.coupon_code);
                  }

                  const { error: couponError } = await query;

                  if (couponError) {
                    console.error("❌ Coupon update failed:", couponError);
                  } else {
                    console.log("✅ Coupon marked as used:", appliedCoupon.coupon_code);
                  }
                }

                // Referral reward logic moved to database trigger (on COMPLETED status)


                // ℹ️ Invoice email is NOT sent here.
                // It is triggered automatically by a Supabase Database Webhook
                // when an admin marks work_status = 'COMPLETED'.

              } catch (err) {
                console.error("❌ Error in success handler:", err);
              }
            } else {
              console.warn("⚠️ pendingBookingData is null - booking may not be saved");
            }

            // Wait a moment for real-time sync before navigating
            setTimeout(() => {
              setPendingBookingData(null);
              navigate("/my-bookings");
            }, 1000);
          }}
        />
      )}

      {policyModalOpen && (
        <PolicyModal
          title={modalTitle}
          content={modalContent}
          loading={loadingPolicy}
          onClose={() => setPolicyModalOpen(false)}
        />
      )}

      <div className="payment-container">
        <button className="back-btn-center-left" onClick={() => navigate(-1)} title="Go Back">
          <FiArrowLeft />
        </button>
        <div className="payment-layout">
          <div className="payment-left-section">
            <h1 className="page-title">Personal Details</h1>
            <p className="subtitle">Enter your contact and address details to continue.</p>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First Name *"
            />
            <input value={email} disabled />
            <div className="payment-phone-input-wrapper">
              <span className="payment-phone-prefix">+91</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  if (val.length <= 10) setPhone(val);
                }}
                placeholder="Phone Number *"
                className="payment-phone-input-with-prefix"
              />
            </div>

            <div className="address-section-wrapper">
              {isAddressSummaryMode && hasUsedLocationFetch ? (
                <div className="address-summary-card">
                  <div className="address-summary-header">
                    <span className="address-summary-title">SELECTED LOCATION</span>
                  </div>
                  <div className="address-summary-body">
                    <div className="address-summary-icon-box">
                      <div className="address-summary-pin-circle">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" /></svg>
                      </div>
                    </div>
                    <div className="address-summary-details">
                      <p className="address-summary-text">
                        {address}{zip ? ` - ${zip}` : ''}
                      </p>
                    </div>
                    <button
                      className="address-summary-edit-btn"
                      onClick={() => setIsAddressSummaryMode(false)}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                      <span>Edit</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="address-edit-box">
                  <label className="address-edit-label">Full Address (House No, Building, Area) *</label>
                  <textarea
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="e.g. Plot no 1821, flat no 402, Sri sai nilayam, Pragathi nagar, Hyderabad"
                    className="address-edit-textarea"
                  />

                  <label className="address-edit-label">
                    Pincode *
                    {hasUsedLocationFetch && (
                      <span className="pincode-verify-hint">⚠️ Please verify — GPS pincode may be inaccurate</span>
                    )}
                  </label>
                  <input
                    value={zip}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "");
                      if (val.length <= 6) setZip(val);
                    }}
                    placeholder="500090"
                    className={`address-edit-pincode${hasUsedLocationFetch ? " address-edit-pincode--verify" : ""}`}
                  />

                  {hasUsedLocationFetch && (
                    <button
                      className="address-done-btn"
                      onClick={() => setIsAddressSummaryMode(true)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      Done Editing
                    </button>
                  )}
                </div>
              )}

              {zip.length === 6 && (
                <div className={`pincode-status-box ${isCheckingPincode ? 'checking' : isPincodeServiceable ? 'available' : 'unavailable'}`}>
                  <div className="pincode-status-icon">
                    {isCheckingPincode ? (
                      <svg className="spin-anim" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
                    ) : isPincodeServiceable ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="#10B981" stroke="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"></path></svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="#EF4444" stroke="none"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"></path></svg>
                    )}
                  </div>
                  <div className="pincode-status-text">
                    <strong>{isCheckingPincode ? 'Checking...' : isPincodeServiceable ? 'Service Available' : 'Service Not Available'}</strong>
                    <p>{isCheckingPincode ? 'Verifying your area' : isPincodeServiceable ? 'You can continue with booking.' : 'We will be available soon in your area.'}</p>
                  </div>
                </div>
              )}

            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Message (Optional)"
              className="message-textarea"
            />
          </div>

          <div className="payment-right-section">
            <h3 className="section-title">Service Details</h3>
            <div className="services-wrapper">
              {servicesWithPromotions.map((service, idx) => (
                <div className="service-item" key={idx}>
                  <div className="summary-item-title-row">
                    <strong className="service-item-title">{service.title || service.name}</strong>
                    {service.quantity > 1 && (
                      <span className="qty-badge">x{service.quantity}</span>
                    )}
                  </div>
                  <p className="service-item-duration">
                    {formatDuration(service.duration)}
                  </p>
                  <div className="service-item-price-row">
                    {service.promoDiscountPerUnit > 0 ? (
                      <div className="promo-breakdown" style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', marginTop: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#64748b' }}>
                          <span>Original Price:</span>
                          <span style={{ textDecoration: 'line-through' }}>{getCurrency(service.displayOriginalPrice)}{formatPrice(service.displayOriginalPrice)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#10b981', fontWeight: '600' }}>
                          <span>Promo Discount:</span>
                          <span>- {getCurrency(service.promoDiscountPerUnit)}{formatPrice(service.promoDiscountPerUnit)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', color: '#0f172a', fontWeight: '700', marginTop: '4px', paddingTop: '4px', borderTop: '1px solid #e2e8f0' }}>
                          <span>Final Price:</span>
                          <span>{getCurrency(service.displayFinalPrice)}{formatPrice(service.displayFinalPrice)}</span>
                        </div>
                      </div>
                    ) : (
                      <>
                        {service.original_price && (
                          <span className="mrp">
                            {getCurrency(service.original_price)}{formatPrice(service.original_price)}
                          </span>
                        )}
                        <span className="service-item-price">
                          {getCurrency(service.price)}{formatPrice(service.price)}
                        </span>
                        {(service.discount_label || service.discount_percent > 0 || (service.original_price && service.price)) && (
                          <span className="offer-badge">
                            {(() => {
                              const calculatedPct = (service.original_price && service.price)
                                ? Math.round((1 - parseFloat(String(service.price).replace(/[^\d.]/g, "")) / parseFloat(String(service.original_price).replace(/[^\d.]/g, ""))) * 100)
                                : 0;

                              if (service.isAddon) {
                                if (calculatedPct > 0) return `${calculatedPct}% OFF`;
                                if (service.discount_percent > 0) return `${service.discount_percent}% OFF`;
                                return service.discount_label || "SPECIAL OFFER";
                              }

                              if (service.discount_label) return service.discount_label;
                              if (calculatedPct > 0) return `${calculatedPct}% OFF`;
                              return "SPECIAL OFFER";
                            })()}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <p className="service-item-date">
                    {date} {MONTHS[month]} {year} at {time}
                  </p>
                  {service.isAddon && (
                    <div className="service-item-actions">
                      <button
                        className="remove-btn"
                        onClick={() => removeService(service.id)}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {addOns.length > 0 && (
                <button
                  className="add-more-services-btn"
                  onClick={() => setShowAddService(true)}
                >
                  +add ons
                </button>
              )}
            </div>

            <div className="summary-bottom">
              <div className="coupon-section">
                <h4 className="coupon-title">Have a coupon code?</h4>
                {effectivelyAppliedCoupon ? (
                  <div className="coupon-applied-box" style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '12px 16px', backgroundColor: '#ecfdf5', borderRadius: '12px', border: '1px solid #10b981', marginTop: '10px'
                  }}>
                    <span style={{ color: '#065f46', fontWeight: '600', fontSize: '14px' }}>
                      ✅ {effectivelyAppliedCoupon.coupon_code} applied! ({effectivelyAppliedCoupon.discount_amount && effectivelyAppliedCoupon.discount_amount > 0 ? `₹${effectivelyAppliedCoupon.discount_amount} off` : `${effectivelyAppliedCoupon.discount_percentage}% off`})
                    </span>
                    <button
                      onClick={handleRemoveCoupon}
                      style={{ background: 'none', border: 'none', color: '#ef4444', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="coupon-input-group">
                      <input
                        type="text"
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                        placeholder="ENTER CODE"
                        className="coupon-input"
                        disabled={isVerifyingCoupon}
                      />
                      <button
                        className="coupon-apply-btn"
                        onClick={handleApplyCoupon}
                        disabled={isVerifyingCoupon || !couponInput.trim()}
                      >
                        {isVerifyingCoupon ? "..." : "Apply"}
                      </button>
                    </div>
                  </>
                )}
                {couponStatus.message && !appliedCoupon && (
                  <p className={`coupon-status ${couponStatus.type}`}>
                    {couponStatus.message}
                  </p>
                )}
              </div>
              <div className="total-row">
                <span>Total Duration</span>
                <strong>
                  {totalDurationMins} mins
                </strong>
              </div>

              {walletBalance > 0 && (
                <div className="wallet-selection-box" style={{
                  padding: "15px",
                  background: "#f8fafc",
                  borderRadius: "12px",
                  border: "1px solid #e2e8f0",
                  marginBottom: "15px",
                  marginTop: "10px"
                }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={useWallet}
                      onChange={(e) => setUseWallet(e.target.checked)}
                      style={{ width: "18px", height: "18px", accentColor: "#10b981" }}
                    />
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: "14px", fontWeight: "600", color: "#1e293b" }}>Use Wallet Balance</span>
                      <span style={{ fontSize: "12px", color: "#64748b" }}>Available: ₹{walletBalance}</span>
                    </div>
                  </label>
                </div>
              )}

              <div className="total-row">
                <span>Subtotal</span>
                <strong>{currency}{totalAmount}</strong>
              </div>

              {appliedCoupon && (
                <div className="total-row coupon-row">
                  <span>Coupon Discount ({appliedCoupon.discount_amount && appliedCoupon.discount_amount > 0 ? `₹${appliedCoupon.discount_amount}` : `${appliedCoupon.discount_percentage}%`})</span>
                  <strong className="discount-value">-{currency}{couponDiscount.toFixed(2)}</strong>
                </div>
              )}

              {useWallet && walletDeduction > 0 && (
                <div className="total-row coupon-row">
                  <span>Wallet Deduction</span>
                  <strong className="discount-value">-{currency}{walletDeduction.toFixed(2)}</strong>
                </div>
              )}

              <div className="total-row">
                <span>Tax (GST)</span>
                <strong>{currency}{totalTax.toFixed(2)}</strong>
              </div>

              <div className="total-amount-row-premium">
                <span className="total-label">Total Amount</span>
                <div className="total-price-stack">
                  {totalOriginalAmount > totalAmount && (
                    <span className="total-price-mrp">{currency}{totalOriginalAmount}</span>
                  )}
                  <strong className="total-price-main">{currency}{finalTotalAmount.toFixed(2)}</strong>
                  {(selectedServices[0]?.discount_percent > 0 ||
                    selectedServices[0]?.discount_label) && (
                      <span className="total-offer-badge">
                        {(selectedServices[0].discount_label ||
                          (selectedServices[0].discount_percent > 0
                            ? `${selectedServices[0].discount_percent}% OFF`
                            : "SPECIAL OFFER")).toUpperCase()}
                      </span>
                    )}
                </div>
              </div>

              <div style={{ marginTop: "18px" }}>
                <label
                  style={{ display: "flex", gap: "10px", marginBottom: "8px" }}
                >
                  <input
                    type="checkbox"
                    checked={acceptPolicies}
                    onChange={(e) => setAcceptPolicies(e.target.checked)}
                  />
                  <span>
                    I accept the{" "}
                    <span
                      className="policy-link"
                      onClick={() =>
                        fetchPolicy("user_policies", "User Policies")
                      }
                    >
                      User Policies
                    </span>
                  </span>
                </label>

                <label style={{ display: "flex", gap: "10px" }}>
                  <input
                    type="checkbox"
                    checked={agreeTerms}
                    onChange={(e) => setAgreeTerms(e.target.checked)}
                  />
                  <span>
                    I agree to the{" "}
                    <span
                      className="policy-link"
                      onClick={() =>
                        fetchPolicy(
                          "terms_and_conditions",
                          "Terms & Conditions",
                        )
                      }
                    >
                      Terms & Conditions
                    </span>
                  </span>
                </label>
              </div>

              <button
                className="primary-btn"
                onClick={handlePlaceOrderAndPay}
                disabled={!acceptPolicies || !agreeTerms || isPaying}
              >
                {isPaying ? "Processing Payment..." : "Place Order & Pay"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MOBILE STICKY FOOTER */}
      <div className="mobile-payment-footer">
        <div>
          <div className="footer-total">{currency}{finalTotalAmount.toFixed(2)}</div>
          {appliedCoupon && <div className="footer-discount">Saved {currency}{couponDiscount.toFixed(2)}</div>}
          <div className="footer-sub">Total Amount</div>
        </div>
        <button
          className="mobile-primary-btn"
          onClick={handlePlaceOrderAndPay}
          disabled={!acceptPolicies || !agreeTerms || isPaying}
        >
          {isPaying ? "Processing..." : "Pay Now"}
        </button>
      </div>

      {/* ================= ADD-ONS SELECTION MODAL ================= */}
      {showAddService && (
        <div className="modal-overlay-payment">
          <div className="modal-container-payment addon-list-modal">
            <div className="modal-header-payment">
              <h3 className="modal-heading-payment">Add Ons</h3>
              <button
                className="modal-close-icon-payment"
                onClick={() => setShowAddService(false)}
              >
                <FiX size={20} />
              </button>
            </div>

            <div className="modal-scroll-content-payment">
              <div className="addon-list-wrapper">
                {addOns.map((svc) => {
                  const isSelected = selectedServices.find((s) => s.id === svc.id);
                  const discountPct = svc.discount_percent || (
                    svc.original_price && svc.price
                      ? Math.round((1 - parseFloat(String(svc.price).replace(/[^\d.]/g, "")) / parseFloat(String(svc.original_price).replace(/[^\d.]/g, ""))) * 100)
                      : 0
                  );
                  return (
                    <div
                      key={svc.id}
                      className={`addon-list-item ${isSelected ? "selected-addon-card" : ""}`}
                      onClick={(e) => {
                        if (e.target.closest('.addon-list-actions') || e.target.closest('.view-addon-btn')) return;
                        fetchAndShowDetail(svc);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="addon-list-content">
                        <div className="summary-item-header">
                          <span className="service-name">{svc.title}</span>
                          <div className="addon-badges-group">
                            <span className="service-time">
                              {formatDuration(svc.duration)}
                            </span>
                            {discountPct > 0 && (
                              <span className="addon-discount-badge">{discountPct}% OFF</span>
                            )}
                          </div>
                        </div>

                        <div className="summary-item-footer">
                          <div className="summary-price">
                            {svc.original_price && (
                              <span className="mrp">
                                {getCurrency(svc.original_price)}{formatPrice(svc.original_price)}
                              </span>
                            )}
                            <span className="offer-price">
                              {getCurrency(svc.price)}{formatPrice(svc.price)}
                            </span>
                          </div>

                          <div className="addon-list-actions">
                            <button
                              className="view-addon-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                fetchAndShowDetail(svc);
                              }}
                            >
                              View
                            </button>

                            {isSelected ? (
                              <div className="quantity-control-boxed" onClick={(e) => e.stopPropagation()}>
                                <button
                                  className="qty-btn-minus"
                                  onClick={() => removeService(svc.id)}
                                >
                                  -
                                </button>
                                <span className="qty-count">
                                  {isSelected.quantity}
                                </span>
                                <button
                                  className="qty-btn-plus"
                                  onClick={() => addService(svc)}
                                >
                                  +
                                </button>
                              </div>
                            ) : (
                              <button
                                className="add-service-btn-small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addService(svc);
                                }}
                              >
                                + Add
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="modal-footer-payment">
              <button
                className="modal-continue-btn"
                onClick={() => setShowAddService(false)}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
      {showAddOnDetail && selectedAddOn && (
        <div className="modal-overlay-payment">
          <div
            className="modal-container-payment addon-detail-modal"
          >
            <div className="addon-detail-hero">
              <button
                className="modal-close-hero"
                onClick={() => setShowAddOnDetail(false)}
              >
                <FiX size={18} />
              </button>
              <img src={selectedAddOn.image} alt={selectedAddOn.title} />
            </div>

            <div className="addon-detail-body">
              <h2 className="addon-detail-title">{selectedAddOn.title}</h2>
              <p className="addon-detail-meta">
                {selectedAddOn.duration} mins • {selectedAddOn.service_type || "ADDITIONAL SERVICES"}
              </p>

              <div className="addon-detail-price-row">
                {selectedAddOn.original_price && (
                  <span className="mrp">
                    {getCurrency(selectedAddOn.original_price)}
                    {formatPrice(selectedAddOn.original_price)}
                  </span>
                )}
                <span className="offer-price">
                  {getCurrency(selectedAddOn.price)}
                  {formatPrice(selectedAddOn.price)}
                </span>
                {(selectedAddOn.discount_percent > 0 || (selectedAddOn.original_price && selectedAddOn.price)) && (
                  <span className="addon-discount-badge detail-badge">
                    {selectedAddOn.discount_percent ||
                      Math.round((1 - parseFloat(String(selectedAddOn.price).replace(/[^\d.]/g, "")) / parseFloat(String(selectedAddOn.original_price).replace(/[^\d.]/g, ""))) * 100)}% OFF
                  </span>
                )}
              </div>

              {selectedServices.find((s) => s.id === selectedAddOn.id) ? (
                <div className="addon-detail-quantity">
                  <button className="qty-btn" onClick={() => removeService(selectedAddOn.id)}>-</button>
                  <span className="qty-count">
                    {selectedServices.find((s) => s.id === selectedAddOn.id).quantity}
                  </span>
                  <button
                    className="qty-btn"
                    onClick={() => addService(selectedAddOn)}
                  >
                    +
                  </button>
                </div>
              ) : (
                <button
                  className="addon-add-btn shine-btn"
                  onClick={() => addService(selectedAddOn)}
                >
                  + Add to Booking
                </button>
              )}

              <div className="addon-detail-info">
                {isFetchingDetail ? (
                  <p style={{ color: "#888", fontSize: "14px", padding: "8px 0" }}>Loading details...</p>
                ) : (
                  <>
                    <h3 className="section-subtitle">Description</h3>
                    <p>
                      {selectedAddOn.description ||
                        `Neatify ${selectedAddOn.title} ensures a clean and fresh space.`}
                    </p>

                    {selectedAddOn.work_includes && (
                      <>
                        <h3 className="work-includes-heading">Work Includes</h3>
                        <ul className="work-includes-list">
                          {(typeof selectedAddOn.work_includes === "string"
                            ? selectedAddOn.work_includes.split("\n")
                            : Array.isArray(selectedAddOn.work_includes)
                              ? selectedAddOn.work_includes
                              : []
                          ).map((item, i) => (
                            <li key={i}>{item.trim()}</li>
                          ))}
                        </ul>
                      </>
                    )}

                    {selectedAddOn.work_not_included && (
                      <>
                        <h3 className="work-not-included-heading">Work Not Included</h3>
                        <ul className="work-not-included-list">
                          {(typeof selectedAddOn.work_not_included === "string"
                            ? selectedAddOn.work_not_included.split("\n")
                            : Array.isArray(selectedAddOn.work_not_included)
                              ? selectedAddOn.work_not_included
                              : []
                          ).map((item, i) => (
                            <li key={i}>{item.trim()}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
                <div style={{ paddingBottom: "30px" }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ===== MODAL ===== */
function Modal({ title, text, onClose, isCritical }) {
  const [disabled, setDisabled] = useState(false);

  return (
    <div style={overlayStyle}>
      <div
        style={{ ...cardStyle, border: isCritical ? "2px solid red" : "none" }}
      >
        <h3 style={{ color: isCritical ? "red" : "black" }}>
          {title || "Confirm"}
        </h3>
        <p style={{ whiteSpace: "pre-wrap" }}>{text}</p>
        <button
          style={{ ...okBtnStyle, opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
          disabled={disabled}
          onClick={() => {
            setDisabled(true);
            onClose();
          }}
        >
          {disabled ? "..." : "OK"}
        </button>
      </div>
    </div>
  );
}

/* ===== POLICY MODAL ===== */
function PolicyModal({ title, content, loading, onClose }) {

  return (
    <div className="policy-overlay">
      <div className="policy-modal">
        <div className="policy-header">
          <h2>{title}</h2>
          <button className="policy-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="policy-body">
          {loading ? (
            <p>Loading...</p>
          ) : (
            <div className="policy-content">
              {(() => {
                if (!content) return null;
                // Split content into points based on " - " or leading "- "
                const points = content
                  .split(/\s-\s|^-\s|^-/)
                  .map((p) => p.trim())
                  .filter(Boolean);

                if (points.length > 1) {
                  return (
                    <ul className="policy-list">
                      {points.map((point, idx) => (
                        <li key={idx}>{point}</li>
                      ))}
                    </ul>
                  );
                }
                // Fallback for non-bulleted content
                return <div dangerouslySetInnerHTML={{ __html: content }} />;
              })()}
            </div>
          )}
        </div>
        <div className="policy-footer">
          <button className="policy-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const cardStyle = {
  background: "#fff",
  padding: "30px",
  borderRadius: "12px",
  width: "380px",
  textAlign: "center",
};

const okBtnStyle = {
  marginTop: "20px",
  padding: "10px 28px",
  background: "#f4c430",
  border: "none",
  borderRadius: "6px",
  fontWeight: "bold",
  cursor: "pointer",
};
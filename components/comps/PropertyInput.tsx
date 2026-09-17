"use client";

import React, { useState } from "react";
import { Search, Building2, Loader2, Home, MapPin, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ALL_TOWNS,
  ALL_PROPERTY_TYPES,
  ALL_AMENITIES,
  detectCompTown,
  type Town,
  type PropertyType,
  type Amenity,
  type SubjectProperty,
} from "@/types/comps";

interface PropertyInputProps {
  onSubmit: (subject: SubjectProperty) => void;
  loading: boolean;
}

type Tab = "address" | "appfolio" | "manual";

interface AppFolioUnit {
  unitId: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  listedRent: number;
  marketRent: number;
  rentReady: boolean;
}

interface AppFolioResult {
  propertyId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  propertyType: string;
  units: AppFolioUnit[];
}

interface AddressLookupResult {
  formatted_address: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  county: string | null;
  town: Town | null;
  property: {
    bedrooms: number | null;
    bathrooms: number | null;
    sqft: number | null;
    property_type: PropertyType | null;
    year_built: number | null;
    lot_size: number | null;
    last_sale_price: number | null;
    features: {
      garage: boolean;
      ac: boolean;
      heating: boolean;
    };
  } | null;
  sources: string[];
}

export function PropertyInput({ onSubmit, loading }: PropertyInputProps) {
  const [tab, setTab] = useState<Tab>("address");

  // Address lookup state
  const [addressQuery, setAddressQuery] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupResult, setLookupResult] = useState<AddressLookupResult | null>(
    null
  );
  const [lookupError, setLookupError] = useState<string | null>(null);

  // AppFolio search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<AppFolioResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Manual form state
  const [address, setAddress] = useState("");
  const [town, setTown] = useState<Town>("Bend");
  const [zipCode, setZipCode] = useState("");
  const [bedrooms, setBedrooms] = useState("3");
  const [bathrooms, setBathrooms] = useState("2");
  const [sqft, setSqft] = useState("");
  const [propertyType, setPropertyType] = useState<PropertyType>("SFR");
  const [currentRent, setCurrentRent] = useState("");
  const [amenities, setAmenities] = useState<string[]>([]);

  function toggleAmenity(val: string) {
    setAmenities((prev) =>
      prev.includes(val) ? prev.filter((a) => a !== val) : [...prev, val]
    );
  }

  // ==================== Address Lookup ====================
  async function handleAddressLookup() {
    if (addressQuery.trim().length < 5) {
      setLookupError("Enter a full address (e.g. 123 Main St, Bend, OR)");
      return;
    }

    setLookingUp(true);
    setLookupError(null);
    setLookupResult(null);

    try {
      const res = await fetch(
        `/api/comps/address-lookup?address=${encodeURIComponent(addressQuery.trim())}`
      );
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setLookupResult(data);
    } catch (err) {
      setLookupError(
        err instanceof Error ? err.message : "Address lookup failed"
      );
    } finally {
      setLookingUp(false);
    }
  }

  function handleSelectLookupResult() {
    if (!lookupResult) return;

    const prop = lookupResult.property;
    const detectedAmenities: Amenity[] = [];
    if (prop?.features.garage) detectedAmenities.push("garage");
    if (prop?.features.ac) detectedAmenities.push("ac");

    onSubmit({
      address: lookupResult.formatted_address,
      town: lookupResult.town || "Bend",
      zip_code: lookupResult.zip || undefined,
      bedrooms: prop?.bedrooms || 3,
      bathrooms: prop?.bathrooms || undefined,
      sqft: prop?.sqft || undefined,
      property_type: prop?.property_type || "SFR",
      amenities: detectedAmenities.length > 0 ? detectedAmenities : undefined,
    });
  }

  // ==================== AppFolio Search ====================
  async function handleSearch() {
    if (searchQuery.trim().length < 3) {
      setSearchError("Enter at least 3 characters to search");
      return;
    }

    setSearching(true);
    setSearchError(null);
    setSearchResults([]);

    try {
      const res = await fetch(
        `/api/comps/appfolio-lookup?address=${encodeURIComponent(searchQuery.trim())}`
      );
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setSearchResults(data.properties || []);
      if (data.properties?.length === 0) {
        setSearchError(
          "No properties found. Try a different search or use Address Lookup."
        );
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function selectUnit(property: AppFolioResult, unit: AppFolioUnit) {
    const detectedTown = detectCompTown(property.city) || "Bend";

    const ptMap = (pt: string): PropertyType => {
      const t = pt.toLowerCase();
      if (t.includes("single") || t.includes("house") || t.includes("sfr"))
        return "SFR";
      if (t.includes("apartment") || t.includes("apt")) return "Apartment";
      if (t.includes("townhouse") || t.includes("townhome")) return "Townhouse";
      if (t.includes("duplex")) return "Duplex";
      if (t.includes("condo")) return "Condo";
      if (t.includes("manufactured") || t.includes("mobile"))
        return "Manufactured";
      return "Other";
    };

    const fullAddress = [
      property.address,
      property.city,
      property.state,
      property.zip,
    ]
      .filter(Boolean)
      .join(", ");

    onSubmit({
      address: fullAddress,
      town: detectedTown,
      zip_code: property.zip,
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms || undefined,
      sqft: unit.sqft || undefined,
      property_type: ptMap(property.propertyType),
      current_rent: unit.listedRent || unit.marketRent || undefined,
      appfolio_property_id: property.propertyId,
    });
  }

  // ==================== Manual Submit ====================
  function handleManualSubmit() {
    if (!address.trim()) return;

    onSubmit({
      address: address.trim(),
      town,
      zip_code: zipCode.trim() || undefined,
      bedrooms: Number(bedrooms),
      bathrooms: bathrooms ? Number(bathrooms) : undefined,
      sqft: sqft ? Number(sqft) : undefined,
      property_type: propertyType,
      amenities: amenities as Amenity[],
      current_rent: currentRent ? Number(currentRent) : undefined,
    });
  }

  // ==================== Tab button helper ====================
  function TabButton({
    id,
    icon: Icon,
    label,
  }: {
    id: Tab;
    icon: React.ElementType;
    label: string;
  }) {
    return (
      <button
        type="button"
        onClick={() => setTab(id)}
        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3.5 text-sm font-medium transition-all duration-200 ${
          tab === id
            ? "bg-white/60 text-charcoal-900 border-b-2 border-terra-600"
            : "text-charcoal-400 hover:text-charcoal-600 hover:bg-white/30"
        }`}
      >
        <Icon className="h-4 w-4" />
        {label}
      </button>
    );
  }

  return (
    <div className="glass-heavy glass-elevated rounded-2xl overflow-hidden">
      {/* Tab header */}
      <div className="flex border-b border-charcoal-200/50">
        <TabButton id="address" icon={Globe} label="Address Lookup" />
        <TabButton id="appfolio" icon={Building2} label="AppFolio" />
        <TabButton id="manual" icon={Home} label="Manual" />
      </div>

      <div className="p-6">
        {/* ==================== Address Lookup Tab ==================== */}
        {tab === "address" && (
          <div className="space-y-5">
            <p className="text-sm text-charcoal-500">
              Enter any address to auto-fill property details from public
              records.
            </p>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-charcoal-400" />
                <Input
                  value={addressQuery}
                  onChange={(e) => setAddressQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddressLookup()}
                  placeholder="123 NW Franklin Ave, Bend, OR 97703"
                  className="pl-9 bg-white/70 backdrop-blur-sm"
                  disabled={lookingUp || loading}
                />
              </div>
              <Button
                onClick={handleAddressLookup}
                disabled={
                  lookingUp || loading || addressQuery.trim().length < 5
                }
                className="bg-gradient-to-r from-terra-600 to-green-700 hover:from-terra-700 hover:to-green-800 text-white shadow-glow"
              >
                {lookingUp ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Look Up"
                )}
              </Button>
            </div>

            {lookupError && (
              <div className="p-3 bg-amber-50/80 backdrop-blur-sm border border-amber-200/50 rounded-xl text-amber-700 text-sm">
                {lookupError}
              </div>
            )}

            {/* Lookup result */}
            {lookupResult && (
              <div className="bg-white/60 backdrop-blur-sm rounded-xl border border-charcoal-200/50 overflow-hidden">
                <div className="px-4 py-3 border-b border-charcoal-100/50">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-terra-600 flex-shrink-0" />
                    <span className="font-medium text-sm text-charcoal-900">
                      {lookupResult.formatted_address}
                    </span>
                  </div>
                  {lookupResult.town && (
                    <p className="text-xs text-terra-600 mt-0.5 pl-6">
                      Service area: {lookupResult.town}, OR
                    </p>
                  )}
                  {!lookupResult.town && (
                    <p className="text-xs text-amber-600 mt-0.5 pl-6">
                      Outside HDPM service area &mdash; analysis will use
                      closest comps
                    </p>
                  )}
                </div>

                {lookupResult.property ? (
                  <div className="px-4 py-3 space-y-2">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <p className="text-[10px] font-medium text-charcoal-400 uppercase tracking-wider">
                          Bedrooms
                        </p>
                        <p className="text-sm font-semibold text-charcoal-900">
                          {lookupResult.property.bedrooms ?? "--"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium text-charcoal-400 uppercase tracking-wider">
                          Bathrooms
                        </p>
                        <p className="text-sm font-semibold text-charcoal-900">
                          {lookupResult.property.bathrooms ?? "--"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium text-charcoal-400 uppercase tracking-wider">
                          Sqft
                        </p>
                        <p className="text-sm font-semibold text-charcoal-900">
                          {lookupResult.property.sqft
                            ? lookupResult.property.sqft.toLocaleString()
                            : "--"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium text-charcoal-400 uppercase tracking-wider">
                          Type
                        </p>
                        <p className="text-sm font-semibold text-charcoal-900">
                          {lookupResult.property.property_type || "--"}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {lookupResult.property.year_built && (
                        <div>
                          <p className="text-[10px] font-medium text-charcoal-400 uppercase tracking-wider">
                            Year Built
                          </p>
                          <p className="text-sm text-charcoal-700">
                            {lookupResult.property.year_built}
                          </p>
                        </div>
                      )}
                      {lookupResult.property.lot_size && (
                        <div>
                          <p className="text-[10px] font-medium text-charcoal-400 uppercase tracking-wider">
                            Lot Size
                          </p>
                          <p className="text-sm text-charcoal-700">
                            {lookupResult.property.lot_size.toLocaleString()}{" "}
                            sqft
                          </p>
                        </div>
                      )}
                      {lookupResult.property.last_sale_price && (
                        <div>
                          <p className="text-[10px] font-medium text-charcoal-400 uppercase tracking-wider">
                            Last Sale
                          </p>
                          <p className="text-sm text-charcoal-700">
                            $
                            {lookupResult.property.last_sale_price.toLocaleString()}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Detected features */}
                    {(lookupResult.property.features.garage ||
                      lookupResult.property.features.ac) && (
                      <div className="flex gap-2 pt-1">
                        {lookupResult.property.features.garage && (
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-terra-100/80 text-terra-700 rounded-full">
                            Garage
                          </span>
                        )}
                        {lookupResult.property.features.ac && (
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-terra-100/80 text-terra-700 rounded-full">
                            A/C
                          </span>
                        )}
                        {lookupResult.property.features.heating && (
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-terra-100/80 text-terra-700 rounded-full">
                            Heating
                          </span>
                        )}
                      </div>
                    )}

                    <p className="text-[10px] text-charcoal-400 pt-1">
                      Data from: {lookupResult.sources.join(", ")}
                    </p>
                  </div>
                ) : (
                  <div className="px-4 py-3">
                    <p className="text-xs text-charcoal-500">
                      Address validated but no property details found. You can
                      use this address and fill in details manually.
                    </p>
                  </div>
                )}

                <div className="px-4 py-3 border-t border-charcoal-100/50 flex justify-end">
                  <Button
                    onClick={handleSelectLookupResult}
                    disabled={loading}
                    className="bg-gradient-to-r from-terra-600 to-green-700 hover:from-terra-700 hover:to-green-800 text-white shadow-glow hover:shadow-glow-lg transition-all duration-200"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4 mr-2" />
                    )}
                    Analyze This Property
                  </Button>
                </div>
              </div>
            )}

            <p className="text-xs text-charcoal-400">
              Works for any US address &mdash; not just properties in AppFolio.{" "}
              <button
                type="button"
                onClick={() => setTab("appfolio")}
                className="text-terra-600 hover:text-terra-700 font-medium"
              >
                Search AppFolio instead
              </button>
            </p>
          </div>
        )}

        {/* ==================== AppFolio Tab ==================== */}
        {tab === "appfolio" && (
          <div className="space-y-5">
            <p className="text-sm text-charcoal-500">
              Search your AppFolio properties by address to auto-fill the
              property details.
            </p>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-charcoal-400" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Search by address (e.g. 123 Main St)"
                  className="pl-9 bg-white/70 backdrop-blur-sm"
                  disabled={searching || loading}
                />
              </div>
              <Button
                onClick={handleSearch}
                disabled={
                  searching || loading || searchQuery.trim().length < 3
                }
                className="bg-gradient-to-r from-terra-600 to-green-700 hover:from-terra-700 hover:to-green-800 text-white shadow-glow"
              >
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Search"
                )}
              </Button>
            </div>

            {searchError && (
              <div className="p-3 bg-amber-50/80 backdrop-blur-sm border border-amber-200/50 rounded-xl text-amber-700 text-sm">
                {searchError}
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-charcoal-500 uppercase tracking-wider">
                  {searchResults.length} Properties Found
                </p>
                {searchResults.map((prop) => (
                  <div
                    key={prop.propertyId}
                    className="bg-white/60 backdrop-blur-sm rounded-xl border border-charcoal-200/50 overflow-hidden"
                  >
                    <div className="px-4 py-3 border-b border-charcoal-100/50">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-terra-600 flex-shrink-0" />
                        <span className="font-medium text-sm text-charcoal-900">
                          {prop.address}
                        </span>
                      </div>
                      <p className="text-xs text-charcoal-400 mt-0.5 pl-6">
                        {prop.city}, {prop.state} {prop.zip} &middot;{" "}
                        {prop.propertyType}
                        {prop.name && ` &middot; ${prop.name}`}
                      </p>
                    </div>

                    {prop.units.length > 0 ? (
                      <div className="divide-y divide-charcoal-100/50">
                        {prop.units.map((unit) => (
                          <button
                            key={unit.unitId}
                            type="button"
                            onClick={() => selectUnit(prop, unit)}
                            disabled={loading}
                            className="w-full px-4 py-2.5 flex items-center justify-between text-sm hover:bg-terra-50/50 transition-colors disabled:opacity-50"
                          >
                            <div className="flex items-center gap-4 text-charcoal-600">
                              <span>
                                {unit.bedrooms} BR / {unit.bathrooms || "—"} BA
                              </span>
                              {unit.sqft > 0 && (
                                <span>
                                  {unit.sqft.toLocaleString()} sqft
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              {(unit.listedRent || unit.marketRent) > 0 && (
                                <span className="font-semibold text-charcoal-900">
                                  $
                                  {(
                                    unit.listedRent || unit.marketRent
                                  ).toLocaleString()}
                                  /mo
                                </span>
                              )}
                              <span className="text-xs text-terra-600 font-medium">
                                Select &rarr;
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="px-4 py-2.5 text-xs text-charcoal-400">
                        No units found for this property
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-charcoal-400">
              Don&apos;t see your property?{" "}
              <button
                type="button"
                onClick={() => setTab("address")}
                className="text-terra-600 hover:text-terra-700 font-medium"
              >
                Try address lookup
              </button>{" "}
              or{" "}
              <button
                type="button"
                onClick={() => setTab("manual")}
                className="text-terra-600 hover:text-terra-700 font-medium"
              >
                enter manually
              </button>
            </p>
          </div>
        )}

        {/* ==================== Manual Tab ==================== */}
        {tab === "manual" && (
          <div className="space-y-5">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-charcoal-500 uppercase tracking-wider mb-1.5">
                  Address *
                </label>
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Full property address"
                  disabled={loading}
                  className="bg-white/70 backdrop-blur-sm"
                />
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-charcoal-500 uppercase tracking-wider mb-1.5">
                  Town
                </label>
                <select
                  value={town}
                  onChange={(e) => setTown(e.target.value as Town)}
                  disabled={loading}
                  className="flex h-10 w-full rounded-xl border border-input bg-white/70 backdrop-blur-sm px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-600/30 focus-visible:ring-offset-2"
                >
                  {ALL_TOWNS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-charcoal-500 uppercase tracking-wider mb-1.5">
                  Zip Code
                </label>
                <Input
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value)}
                  placeholder="97701"
                  disabled={loading}
                  className="bg-white/70 backdrop-blur-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-charcoal-500 uppercase tracking-wider mb-1.5">
                  Property Type
                </label>
                <select
                  value={propertyType}
                  onChange={(e) =>
                    setPropertyType(e.target.value as PropertyType)
                  }
                  disabled={loading}
                  className="flex h-10 w-full rounded-xl border border-input bg-white/70 backdrop-blur-sm px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-600/30 focus-visible:ring-offset-2"
                >
                  {ALL_PROPERTY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-charcoal-500 uppercase tracking-wider mb-1.5">
                  Bedrooms
                </label>
                <select
                  value={bedrooms}
                  onChange={(e) => setBedrooms(e.target.value)}
                  disabled={loading}
                  className="flex h-10 w-full rounded-xl border border-input bg-white/70 backdrop-blur-sm px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-600/30 focus-visible:ring-offset-2"
                >
                  <option value="0">Studio</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                  <option value="6">6</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-charcoal-500 uppercase tracking-wider mb-1.5">
                  Bathrooms
                </label>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  value={bathrooms}
                  onChange={(e) => setBathrooms(e.target.value)}
                  disabled={loading}
                  className="bg-white/70 backdrop-blur-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-charcoal-500 uppercase tracking-wider mb-1.5">
                  Sqft
                </label>
                <Input
                  type="number"
                  min="0"
                  value={sqft}
                  onChange={(e) => setSqft(e.target.value)}
                  placeholder="--"
                  disabled={loading}
                  className="bg-white/70 backdrop-blur-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-charcoal-500 uppercase tracking-wider mb-1.5">
                  Current Rent
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-400 text-sm">
                    $
                  </span>
                  <Input
                    type="number"
                    min="0"
                    value={currentRent}
                    onChange={(e) => setCurrentRent(e.target.value)}
                    placeholder="Optional"
                    disabled={loading}
                    className="pl-7 bg-white/70 backdrop-blur-sm"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-charcoal-500 uppercase tracking-wider mb-2">
                Amenities
              </label>
              <div className="flex flex-wrap gap-2">
                {ALL_AMENITIES.map((a) => {
                  const active = amenities.includes(a.value);
                  return (
                    <button
                      key={a.value}
                      type="button"
                      onClick={() => toggleAmenity(a.value)}
                      disabled={loading}
                      className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 ${
                        active
                          ? "bg-terra-100/80 text-terra-700 ring-1 ring-terra-300 shadow-sm"
                          : "bg-white/50 text-charcoal-500 hover:bg-white/70 hover:text-charcoal-700"
                      } disabled:opacity-50`}
                    >
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-charcoal-200/50">
              <Button
                onClick={handleManualSubmit}
                disabled={loading || !address.trim()}
                className="bg-gradient-to-r from-terra-600 to-green-700 hover:from-terra-700 hover:to-green-800 text-white shadow-glow hover:shadow-glow-lg transition-all duration-200"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                Analyze Property
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

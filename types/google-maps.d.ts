// Minimal Google Maps type declarations for our usage
declare namespace google.maps {
  class Map {
    constructor(element: HTMLElement, options: MapOptions);
    setCenter(center: LatLngLiteral): void;
    setZoom(zoom: number): void;
    fitBounds(bounds: LatLngBounds, padding?: number): void;
  }

  interface MapOptions {
    center: LatLngLiteral;
    zoom: number;
    mapId?: string;
    disableDefaultUI?: boolean;
    zoomControl?: boolean;
    mapTypeControl?: boolean;
    streetViewControl?: boolean;
    fullscreenControl?: boolean;
    styles?: Array<{
      featureType?: string;
      elementType?: string;
      stylers: Array<Record<string, unknown>>;
    }>;
  }

  interface LatLngLiteral {
    lat: number;
    lng: number;
  }

  class LatLngBounds {
    constructor();
    extend(point: LatLngLiteral): void;
  }

  class Polyline {
    constructor(options: PolylineOptions);
    setMap(map: Map | null): void;
  }

  interface PolylineOptions {
    path: LatLngLiteral[];
    geodesic?: boolean;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWeight?: number;
    map?: Map;
  }

  namespace marker {
    class AdvancedMarkerElement {
      constructor(options: AdvancedMarkerElementOptions);
      map: Map | null;
      addListener(eventName: string, handler: () => void): void;
    }

    interface AdvancedMarkerElementOptions {
      map: Map;
      position: LatLngLiteral;
      title?: string;
      content?: HTMLElement;
    }
  }

  namespace geometry {
    namespace encoding {
      function decodePath(encodedPath: string): LatLngLiteral[];
    }
  }
}

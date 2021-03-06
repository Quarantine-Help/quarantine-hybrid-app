import {
  Component,
  AfterViewInit,
  ViewChild,
  ElementRef,
  OnInit,
} from '@angular/core';
import { ModalController } from '@ionic/angular';
import { fromEventPattern, Observable, Subscription } from 'rxjs';

import { RequestInfoModalComponent } from 'src/app/components/request-info-modal/request-info-modal.component';
import { GeoLocationService } from 'src/app/shared/services/geo-location/geo-location.service';
import { AuthService } from 'src/app/shared/services/auth/auth.service';
import { MiscService } from 'src/app/shared/services/misc/misc.service';
import { CoreAPIService } from 'src/app/shared/services/core-api/core-api.service';
import { environment } from '../../../environments/environment';

import { RequestView, UserThemeColorPrimary } from 'src/app/models/ui';
import { AutoSuggestResultItem } from 'src/app/models/here-map-autosuggest';
import { LatLng } from '../../models/geo';
import {
  NearbyParticipantsResponse,
  NearbyParticipant,
} from '../../models/core-api';
import {
  RequestTypes,
  SearchFilters,
  Category,
} from 'src/app/models/here-map-core';
import {
  defaultUserType,
  defaultPrimaryColor,
} from 'src/app/constants/core-api';
import { debounce, debounceTime, first, throttleTime } from 'rxjs/operators';

@Component({
  selector: 'app-quarantine-map',
  templateUrl: 'quarantine-map.html',
  styleUrls: ['quarantine-map.scss'],
})
export class QuarantineMapPage implements OnInit, AfterViewInit {
  @ViewChild('mapContainer', { static: true }) mapElement: ElementRef;

  private HEREMapsPlatform: H.service.Platform;
  private HEREMapObj: H.Map;
  private HEREMapUI: H.ui.UI;
  private HEREmapEvents: H.mapevents.MapEvents;
  private mapEventsBehavior: H.mapevents.Behavior;
  private defaultLayers: H.service.DefaultLayers;
  private markers: H.map.Marker[];
  private currentLocMarker: H.map.Marker;
  private markerGroup: H.map.Group;
  private locMarkerGroup: H.map.Group;
  private groceryIcon: H.map.Icon;
  private medicalIcon: H.map.Icon;
  private otherIcon: H.map.Icon;
  private allIcon: H.map.Icon;
  private locationIcon: H.map.Icon;
  showSearchResults: boolean;

  currentLocation: LatLng = undefined;
  gpsAccuracy: number;
  loadingAniHEREMap: HTMLIonLoadingElement;
  loadingAniNearbyParticipants: HTMLIonLoadingElement;
  loadingAniGPSData: HTMLIonLoadingElement;
  toastElement: Promise<void>;
  showFiltering: boolean;
  filters: SearchFilters;
  userThemeColorPrimary: UserThemeColorPrimary;
  isLoggedIn: boolean;
  userType: string;
  authSubs: Subscription;
  mapChangeObservable: Observable<any>;

  constructor(
    private geoLocationService: GeoLocationService,
    private miscService: MiscService,
    private coreAPIService: CoreAPIService,
    private modalController: ModalController,
    private authService: AuthService
  ) {
    this.filters = {
      distance: 5,
      categories: ['all'],
    };
    this.showFiltering = false;
    this.showSearchResults = false;
    this.isLoggedIn = false;
    this.mapChangeObservable = undefined;
  }

  ngOnInit() {
    this.userThemeColorPrimary = defaultPrimaryColor;
    this.userType = defaultUserType;
    this.isLoggedIn = false;

    // Sets the page theme based on login status and userType
    this.authSubs = this.authService.user.subscribe((user) => {
      if (user && user.email !== undefined && user.token !== undefined) {
        this.userType = user.type;
        this.isLoggedIn = true;
        this.userThemeColorPrimary =
          this.userType === 'AF' ? 'primaryAF' : 'primaryHL';
      } else {
        this.isLoggedIn = false;
        this.userType = defaultUserType;
        this.userThemeColorPrimary = defaultPrimaryColor;
      }
    });
  }

  ngAfterViewInit() {
    // Create a marker group for future use.
    this.markerGroup = new H.map.Group();
    this.markers = [];

    // initialize Icon files
    this.medicalIcon = new H.map.Icon('assets/common/medicalIcon.svg', {
      crossOrigin: false,
      size: { w: 56, h: 56 },
    });
    this.groceryIcon = new H.map.Icon('assets/common/groceryIcon.svg', {
      crossOrigin: false,
      size: { w: 56, h: 56 },
    });
    this.otherIcon = new H.map.Icon('assets/common/otherIcon.svg', {
      crossOrigin: false,
      size: { w: 56, h: 56 },
    });
    this.allIcon = new H.map.Icon('assets/common/allIcon.svg', {
      crossOrigin: false,
      size: { w: 56, h: 56 },
    });
    this.locationIcon = new H.map.Icon('assets/common/userLocation.svg', {
      crossOrigin: false,
      size: { w: 56, h: 56 },
    });

    // Start the loading animation for getting GPS data
    this.miscService
      .presentLoadingWithOptions({
        duration: 0,
        message: `Getting current location.`,
      })
      .then((onLoadSuccess) => {
        this.loadingAniGPSData = onLoadSuccess;
        this.loadingAniGPSData.present();
        // Get the GPS data
        this.getGPSLocation();
        // Start the map loading process in parallel
        this.initHEREMap();
      })
      .catch((error) => alert(error));
  }

  // TODO
  exitApp() {
    console.error('exitApp not implemented.');
  }

  onFabClick() {
    this.miscService
      .presentLoadingWithOptions({
        duration: 0,
        message: `Getting current location.`,
      })
      .then((onLoadSuccess) => {
        this.loadingAniGPSData = onLoadSuccess;
        this.loadingAniGPSData.present();
        // Get the GPS data
        this.getGPSLocation();
      })
      .catch((error) => alert(error));
  }

  // TODO - refactor ?
  /**
   * Get the GPS latLng and save it. If map is already loaded, then set center
   */
  getGPSLocation() {
    this.geoLocationService
      .getCurrentPosition()
      .then((userLocation) => {
        // Destroy loading controller on dismiss
        if (this.loadingAniGPSData !== undefined) {
          this.loadingAniGPSData.dismiss().then(() => {
            this.loadingAniGPSData = undefined;
          });
        }
        this.currentLocation = {
          lat: userLocation.coords.latitude,
          lng: userLocation.coords.longitude,
        };
        this.gpsAccuracy = userLocation.coords.accuracy;

        // Checks to see if we are re-trying to get GPS or the first time
        if (this.HEREMapObj === undefined) {
          this.initHEREMap();
        } else {
          this.HEREMapObj.setCenter(this.currentLocation, true);
          this.HEREMapObj.setZoom(4, true);
        }

        this.getNearbyParticipants(
          this.filters.distance,
          this.currentLocation,
          this.filters.categories
        );

        this.HEREMapObj.setCenter(this.currentLocation, true);
        this.setCurrentLocationMarker(this.currentLocation);
      })
      .catch((error) => {
        console.error(`ERROR - Unable to getting location`, error);
        // Destroy loading controller on dismiss and ask for a retry
        if (this.loadingAniGPSData) {
          this.loadingAniGPSData.dismiss().then(() => {
            this.loadingAniGPSData = undefined;
          });
        }
        // Show error message and retry option on GPS fail
        this.miscService
          .presentToastWithOptions({
            message: error.message,
            color: 'secondary',
          })
          .then((toast) => {
            this.toastElement = toast.present();
            toast.onWillDismiss().then((OverlayEventDetail) => {
              if (OverlayEventDetail.role === 'cancel') {
                this.exitApp();
              } else {
                this.getGPSLocation();
              }
            });
          });
      });
  }

  // TODO - refactor ?
  initHEREMap() {
    // TODO - Use a map load completion event instead of fixed 3000ms to dismiss loading animation
    // Start a map loading animation and dismiss after 5 sec.
    this.miscService
      .presentLoadingWithOptions({
        duration: 0,
        message: `Loading the map.`,
      })
      .then((onLoadSuccess) => {
        this.loadingAniHEREMap = onLoadSuccess;
        this.loadingAniHEREMap.present();
        this.mapChangeObservable.pipe(first()).subscribe(() => {
          this.loadingAniHEREMap.dismiss();
          this.startMapViewChangeListener();
        });
      })
      .catch((error) => alert(error));

    // Initialize the platform object:
    this.HEREMapsPlatform = new H.service.Platform({
      apikey: environment.HERE_MAPS_JS_KEY,
    });

    // Obtain the default map types from the platform object
    this.defaultLayers = this.HEREMapsPlatform.createDefaultLayers();

    // Instantiate (and display) a map object:
    const INIT_ZOOM_LEVEL = 15;
    this.HEREMapObj = new H.Map(
      this.mapElement.nativeElement,
      this.defaultLayers.vector.normal.map,
      {
        zoom: INIT_ZOOM_LEVEL,
        padding: { top: 50, left: 50, bottom: 50, right: 100 },
      }
    );

    // Edge case : if map loads later than the GPS, we could use the location already fetched
    if (this.currentLocation !== undefined) {
      this.HEREMapObj.setCenter(this.currentLocation, true);
    }

    // Refer : https://developer.here.com/documentation/maps/3.1.14.0/api_reference/H.map.Style.html
    // const provider = this.HEREMapObj.getBaseLayer().getProvider();
    // const style = new H.map.Style(
    //   `assets/normal.day.yaml`,
    //   `https://js.api.here.com/v3/3.1/styles/omv/`
    // );
    // provider.setStyle(style);

    // Create the default UI:
    this.HEREMapUI = H.ui.UI.createDefault(this.HEREMapObj, this.defaultLayers);
    this.HEREMapUI.getControl('zoom').setAlignment(
      H.ui.LayoutAlignment.RIGHT_MIDDLE
    );
    this.HEREMapUI.getControl('mapsettings').setAlignment(
      H.ui.LayoutAlignment.RIGHT_MIDDLE
    );
    this.HEREMapUI.getControl('scalebar').setAlignment(
      H.ui.LayoutAlignment.LEFT_BOTTOM
    );
    // Enable the event system on the map instance:
    this.HEREmapEvents = new H.mapevents.MapEvents(this.HEREMapObj);
    // Instantiate the default behavior on the map events
    this.mapEventsBehavior = new H.mapevents.Behavior(this.HEREmapEvents);

    this.mapChangeObservable = fromEventPattern((handler: any) => {
      this.HEREMapObj.addEventListener('mapviewchangeend', handler);
    }).pipe(debounceTime(2000), throttleTime(2000));
  }

  startMapViewChangeListener() {
    this.mapChangeObservable.subscribe((change) => {
      const currentViewBox: H.geo.Rect = this.HEREMapObj.getViewModel()
        .getLookAtData()
        .bounds.getBoundingBox();
      const diagonalDistance: number = currentViewBox
        .getTopLeft()
        .distance(currentViewBox.getBottomRight());
      this.getNearbyParticipants(
        diagonalDistance,
        this.HEREMapObj.getCenter(),
        this.filters.categories,
        true
      );
    });
  }

  // TODO - refactor
  getNearbyParticipants(
    radius: number,
    latlng: LatLng,
    categories: Category[],
    isMapViewEventTriggered: boolean = false
  ) {
    // Removes all markers, marker group and event listeners.
    this.markers.forEach((marker) => {
      marker.dispose();
    });

    this.HEREMapObj.removeObjects(this.HEREMapObj.getObjects());
    this.setCurrentLocationMarker(this.currentLocation);

    // create a RequestTypes string value for query param, as per API requirements.
    let requestType: RequestTypes;
    if (categories.includes('grocery')) {
      requestType = 'G';
    } else if (categories.includes('medicine')) {
      requestType = 'M';
    } else if (categories.includes('other')) {
      requestType = 'O';
    }

    this.miscService
      .presentLoadingWithOptions({
        duration: 0,
        message: `Looking for nearby requests`,
      })
      .then((onLoadSuccess) => {
        this.loadingAniNearbyParticipants = onLoadSuccess;
        this.loadingAniNearbyParticipants.present();
        this.coreAPIService
          .getNearbyParticipants(radius, latlng, requestType)
          .then((result: NearbyParticipantsResponse) => {
            // Dismiss & destroy loading controller on
            if (this.loadingAniNearbyParticipants !== undefined) {
              this.loadingAniNearbyParticipants.dismiss().then(() => {
                this.loadingAniNearbyParticipants = undefined;
              });
            }
            // Inform user if there are no nearby requests on first load
            if (result.body.count === 0 && !isMapViewEventTriggered) {
              this.miscService.presentAlert({
                header: 'Welcome volunteer',
                subHeader: null,
                message:
                  'There are no requests nearby at the moment. Please use advanced search filters or Chill out, and stay with us 😃',
                buttons: ['Ok'],
              });
            } else {
              this.dropMarkers(result.body.results, !isMapViewEventTriggered);
            }
          });
      })
      .catch((error) => alert(error));
  }

  dropMarkers(participants, doReCenter: boolean = true) {
    participants.forEach((participant: NearbyParticipant) => {
      // Set the correct icon for the marker, based on the requests
      const isGroceryRequest = participant.requests.some(
        (request) => request.type === 'G'
      );
      const isMedicineRequest = participant.requests.some(
        (request) => request.type === 'M'
      );
      const isOtherRequest = participant.requests.some(
        (request) => request.type === 'O'
      );
      let markerIcon;
      if (isGroceryRequest && isMedicineRequest) {
        markerIcon = { icon: this.allIcon };
      } else if (isGroceryRequest) {
        markerIcon = { icon: this.groceryIcon };
      } else if (isMedicineRequest) {
        markerIcon = { icon: this.medicalIcon };
      } else if (isOtherRequest) {
        markerIcon = { icon: this.otherIcon };
      }

      const markerData: RequestView = {
        id: participant.id,
        crisisId: participant.crisis,
        user: participant.user,
        address: {
          firstLineOfAddress: participant.firstLineOfAddress,
          secondLineOfAddress: participant.secondLineOfAddress,
        },
        phone: participant.phone,
        isGroceryRequest,
        isMedicineRequest,
        requests: participant.requests,
      };

      // Create markers for the participants request
      this.createMarker(
        {
          lat: parseFloat(participant.position.latitude),
          lng: parseFloat(participant.position.longitude),
        },
        markerIcon,
        markerData
      );
    });
    this.markerGroup.addObjects(this.markers);
    this.HEREMapObj.addObject(this.markerGroup);

    // get geo bounding box for the group and set it to the map, practically centering the map
    if (doReCenter) {
      this.HEREMapObj.getViewModel().setLookAtData({
        bounds: this.markerGroup.getBoundingBox(),
      });
    }
  }

  setCurrentLocationMarker(location: LatLng) {
    if (this.locMarkerGroup) {
      this.locMarkerGroup.removeAll();
    }

    this.currentLocMarker = new H.map.Marker(location, {
      icon: this.locationIcon,
    });

    // const currentLocAccuracyCircle = new H.map.Circle(
    //   location,
    //   this.gpsAccuracy,
    //   {
    //     style: {
    //       strokeColor: 'rgba(121, 189, 203, 0.7)', // Color of the perimeter
    //       lineWidth: 2,
    //       fillColor: 'rgba(181, 225, 234, 0.4)', // Color of the circle
    //     },
    //   }
    // );

    this.locMarkerGroup = new H.map.Group();
    this.locMarkerGroup.addObjects([
      this.currentLocMarker,
      // currentLocAccuracyCircle,
    ]);
    this.HEREMapObj.addObject(this.locMarkerGroup);
  }

  // Create markers for each participant request and attach handlers to show Request cards onClick
  createMarker(coordinates: LatLng, markerIcon, markerData: RequestView) {
    const marker = new H.map.Marker(coordinates, markerIcon);
    marker.addEventListener(
      'tap',
      (event: any) => {
        this.showRequestCard(
          event.currentPointer,
          this.getLatLngFromScreen(event.currentPointer),
          markerData
        );
      },
      false
    );
    this.markers.push(marker);
  }

  async showRequestCard(
    { viewportX, viewportY },
    coordinates: LatLng,
    markerData: RequestView
  ) {
    const modal = await this.modalController.create({
      component: RequestInfoModalComponent,
      componentProps: {
        viewportX,
        viewportY,
        coordinates,
        markerData,
      },
      cssClass: 'request-modal-wrapper',
    });
    return await modal.present();
  }

  /**
   * Gets a lat lng object from returned using the HERE map screenToGeo method
   * @param event The MapEvent object from the event handler
   * @returns An object containing numerical values 'lat' and 'lng'
   */
  getLatLngFromScreen({ viewportX, viewportY }): LatLng {
    const coordinates = this.HEREMapObj.screenToGeo(viewportX, viewportY);
    // TODO - check precision of coordinates with backend team
    return {
      lat: Math.abs(parseFloat(coordinates.lat.toFixed(4))),
      lng: Math.abs(parseFloat(coordinates.lng.toFixed(4))),
    };
  }

  // Show/hide the map-filter component.
  toggleFiltering() {
    this.showFiltering = !this.showFiltering;
    if (this.showFiltering) {
      this.HEREMapObj.getViewPort().setPadding(50, 50, 120, 100);
    } else {
      this.HEREMapObj.getViewPort().setPadding(50, 50, 50, 100);
    }
  }

  // Apply the filters from the filter component and call the API.
  onFiltersApplied(filters: SearchFilters) {
    this.filters = filters;
    this.getNearbyParticipants(
      this.filters.distance,
      this.HEREMapObj.getCenter(), // When using the search filters, use current map center to query.
      this.filters.categories
    );
  }

  onAddressSelect(address: AutoSuggestResultItem) {
    this.getNearbyParticipants(
      this.filters.distance,
      address.position,
      this.filters.categories
    );
    this.HEREMapObj.setCenter(address.position, true);
  }
}

# Blinds Connector API

This package uses the code by [Bernard Gorman](https://github.com/gormanb?tab=repositories) which he wrote for Homebridge. I only extracted the library code from it to use it in my applications.

this package is able to work with these merchants who all are using the same white label product:

- [AMP Motorization](https://www.ampmotorization.com/)
- [Alta Bliss Automation](https://www.altawindowfashions.com/product/automation/bliss-automation/)
- [Bloc Blinds](https://www.blocblinds.com/)
- [Brel Home](https://www.brel-home.nl/)
- [3 Day Blinds](https://www.3dayblinds.com/)
- [Diaz](https://www.diaz.be/en/)
- [Coulisse B.V.](https://coulisse.com/) [Motion Blinds](https://motionblinds.com/)
- [Gaviota](https://www.gaviotagroup.com/en/)
- [Havana Shade](https://havanashade.com/)
- [Hurrican Shutters Wholesale](https://www.hurricaneshutterswholesale.com/)
- [Inspired Shades](https://www.inspired-shades.com/)
- [iSmartWindow](https://www.ismartwindow.co.nz/)
- [Martec](https://www.martec.co.nz/)
- [Raven Rock MFG](https://www.ravenrockmfg.com/)
- [ScreenAway](https://www.screenaway.com.au/)
- [Smart Blinds](https://www.smartblinds.nl/)
- [Smart Home](https://www.smart-home.hu/)
- [Uprise Smart Shades](http://uprisesmartshades.com/)

The following hubs/bridges are also expected to work with this plugin:

- CM-20 Motion Blinds bridge
- CMD-01 Motion Blinds mini-bridge
- DD7002B Connector bridge
- D1554 Connector mini-bridge
- DD7002B Brel-Home box
- D1554 Brel Home USB plug

Note that the blinds/curtains/etc must already have been paired with the app in order for them to be visible to this plugin.

## Instructions

use the access token gathered from this location:

- In the top-left corner of the screen, tap the Menu button (☰)
- Tap your account profile picture, then go to the About page
- Tap the screen five times to display the key.

For branded apps, the key can be obtained using similar approaches:

- In the Coulisse Motion Blinds app, go to Settings > About and tap the screen five times.
- In the Brel Home app, go to the Me page and tap five times on either the `version` field (iOS) or to the right of the photo placeholder (Android).
- In the Bloc Blinds app, go to Settings > About and tap five times on the Bloc Blinds icon.

## useage

```typescript
import { ConnectorHubClient } from "blinds-connector-api";
const ip = "127.0.0.1";

const devices = await ConnectorHubClient.getDeviceList(ip);
const device = devices[0];
device.data.map(
  (shade) => new ConnectorHubClient(accessKey, shade, ip, device.token)
);
```

## Acknowledgements

- Thanks to [@alexbacchin](https://github.com/alexbacchin) for putting together [a repo full of documentation](https://github.com/alexbacchin/ConnectorBridge) about the Connector hub network protocol.
- Thanks to [Bernard Gorman](https://github.com/gormanb?tab=repositories) for writing the Plugin this library is based on.

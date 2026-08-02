package io.handcash.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(Brc100LocalBridgePlugin.class);
        registerPlugin(DeviceAuthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

package com.nur.idua;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NurIDuaTtsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

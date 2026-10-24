package com.dropconvert.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Copies a finished file from the app's private cache into the phone's public
 * Downloads/DropConvert folder using Android's MediaStore (no storage permission needed).
 */
@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {

    @PluginMethod
    public void copyToDownloads(PluginCall call) {
        String src = call.getString("uri");
        String name = call.getString("name");
        String mime = call.getString("mime");
        if (src == null || name == null) {
            call.reject("Missing file or name");
            return;
        }
        if (mime == null) {
            mime = "application/octet-stream";
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Saving to Downloads needs Android 10 or newer. Use Share instead.");
            return;
        }
        Uri target = null;
        ContentResolver resolver = getContext().getContentResolver();
        try {
            File file = new File(Uri.parse(src).getPath());
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/DropConvert");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            target = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (target == null) {
                call.reject("Could not create the file in Downloads");
                return;
            }
            try (InputStream in = new FileInputStream(file); OutputStream out = resolver.openOutputStream(target)) {
                if (out == null) {
                    throw new IOException("Could not open the new file for writing");
                }
                byte[] buffer = new byte[65536];
                int n;
                while ((n = in.read(buffer)) > 0) {
                    out.write(buffer, 0, n);
                }
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(target, done, null, null);
            JSObject result = new JSObject();
            result.put("where", "Downloads/DropConvert");
            call.resolve(result);
        } catch (Exception e) {
            if (target != null) {
                try {
                    resolver.delete(target, null, null);
                } catch (Exception ignored) {
                    // nothing more we can do
                }
            }
            String msg = e.getMessage();
            call.reject(msg == null ? "Could not save the file" : msg);
        }
    }
}

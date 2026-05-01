<?php
/**
 * Plugin Name: WP Publisher — Yoast REST Meta
 * Description: Exposes the Yoast SEO focus keyphrase, meta title (raw template), and meta description on the WordPress REST API for posts and pages, so the WP Publisher dashboard can read them.
 * Version: 1.0.0
 * Author: Internal
 * License: GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('init', function () {
    $meta_keys = [
        '_yoast_wpseo_focuskw',
        '_yoast_wpseo_title',
        '_yoast_wpseo_metadesc',
    ];
    $post_types = ['post', 'page'];

    foreach ($post_types as $post_type) {
        foreach ($meta_keys as $meta_key) {
            register_post_meta($post_type, $meta_key, [
                'type'          => 'string',
                'single'        => true,
                'show_in_rest'  => true,
                'auth_callback' => function () {
                    // Only authenticated editors+ can write through REST.
                    // Read access still flows through the post's own permissions.
                    return current_user_can('edit_posts');
                },
            ]);
        }
    }
});

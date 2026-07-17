<?php
/**
 * Plugin Name: WP Publisher — REST Support
 * Description: Exposes the Yoast SEO focus keyphrase, meta title (raw template), and meta description on the WordPress REST API for posts and pages, and attaches categories/tags to pages, so the WP Publisher dashboard can read and edit them.
 * Version: 1.1.1
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

    // WordPress core attaches categories and tags to posts only. This site's
    // content model puts real topical content on pages too (location pages,
    // practice areas, cluster content), so make both taxonomies available there
    // as well. The REST posts controller builds its taxonomy fields from
    // get_object_taxonomies() at rest_api_init, which runs after init — so
    // registering here is what makes /wp/v2/pages accept and return
    // `categories` and `tags`, and is what the dashboard probes for via
    // /wp/v2/types/page.
    //
    // This registration is ALL that's needed — do not add taxonomy metaboxes on
    // top of it. Core's register_and_do_post_meta_boxes() already loops over
    // get_object_taxonomies() and adds a box per taxonomy (wp-admin/includes/
    // meta-boxes.php), and the block editor renders its own native panel from
    // the same registration. Adding our own produced a second Categories and
    // Tags box in the page sidebar: the block editor swaps out core's boxes by
    // their known ids (categorydiv / tagsdiv-post_tag) but can't recognize a
    // custom id, so ours rendered again underneath as legacy metaboxes.
    register_taxonomy_for_object_type('category', 'page');
    register_taxonomy_for_object_type('post_tag', 'page');
});

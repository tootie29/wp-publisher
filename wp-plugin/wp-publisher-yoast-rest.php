<?php
/**
 * Plugin Name: WP Publisher — REST Support
 * Description: Exposes the Yoast SEO focus keyphrase, meta title (raw template), and meta description on the WordPress REST API for posts and pages, and attaches categories/tags to pages, so the WP Publisher dashboard can read and edit them.
 * Version: 1.1.0
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
    register_taxonomy_for_object_type('category', 'page');
    register_taxonomy_for_object_type('post_tag', 'page');
});

// Pages don't get a taxonomy metabox from core just because the taxonomy is
// registered for them — without this, terms set by the dashboard would be
// invisible (and unremovable) to anyone editing the page in wp-admin.
add_action('add_meta_boxes_page', function () {
    add_meta_box(
        'wp_publisher_page_categories',
        __('Categories'),
        'post_categories_meta_box',
        'page',
        'side',
        'default',
        ['taxonomy' => 'category']
    );
    add_meta_box(
        'wp_publisher_page_tags',
        __('Tags'),
        'post_tags_meta_box',
        'page',
        'side',
        'default',
        ['taxonomy' => 'post_tag']
    );
});
